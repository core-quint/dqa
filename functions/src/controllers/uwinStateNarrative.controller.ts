import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { Response } from "express";
import { z } from "zod";
import { db, FieldValue } from "../lib/firebase";
import type { AuthRequest } from "../middleware/auth.middleware";
import { canAccessState } from "./uwinStateReport.controller";

const PROMPT_VERSION = "uwin-state-narrative-v1";
const MODEL = process.env.UWIN_STATE_AI_MODEL || "gemini-2.5-flash";
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";
const USER_DAILY_LIMIT = Math.max(1, Number(process.env.UWIN_STATE_AI_DAILY_USER_LIMIT || 10));
const PROJECT_MONTHLY_LIMIT = Math.max(1, Number(process.env.UWIN_STATE_AI_MONTHLY_LIMIT || 500));

const narrativeSchema = z.object({
  executiveSummary: z.array(z.object({
    statement: z.string().trim().min(1).max(500),
    evidenceIds: z.array(z.string().trim().min(1)).min(1).max(5),
  })).min(1).max(3),
  keyFindings: z.array(z.object({
    statement: z.string().trim().min(1).max(500),
    evidenceIds: z.array(z.string().trim().min(1)).min(1).max(5),
  })).min(1).max(5),
  positiveSummary: z.object({
    statement: z.string().trim().min(1).max(500),
    evidenceIds: z.array(z.string().trim().min(1)).min(1).max(5),
  }).nullable(),
  highlightedActionRuleIds: z.array(z.string().trim().min(1)).max(6),
});

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["executiveSummary", "keyFindings", "positiveSummary", "highlightedActionRuleIds"],
  properties: {
    executiveSummary: { type: "array", minItems: 1, maxItems: 3, items: { $ref: "#/$defs/evidenceStatement" } },
    keyFindings: { type: "array", minItems: 1, maxItems: 5, items: { $ref: "#/$defs/evidenceStatement" } },
    positiveSummary: { anyOf: [{ $ref: "#/$defs/evidenceStatement" }, { type: "null" }] },
    highlightedActionRuleIds: { type: "array", maxItems: 6, items: { type: "string" } },
  },
  $defs: {
    evidenceStatement: {
      type: "object", additionalProperties: false, required: ["statement", "evidenceIds"],
      properties: {
        statement: { type: "string" },
        evidenceIds: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
      },
    },
  },
};

function enabled() {
  return process.env.UWIN_STATE_AI_ENABLED === "true";
}

function projectId() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildFactView(factPack: Record<string, any>) {
  const evidenceCatalog = [
    { evidenceId: "EV-SCORE-OVERALL", fact: `Overall DQA status is ${factPack.scores.status}; exact value is stored for deterministic rendering.` },
    { evidenceId: "EV-SCORE-AVAILABILITY", fact: "Availability component score is available to the deterministic renderer." },
    { evidenceId: "EV-SCORE-ACCURACY", fact: "Accuracy component score is available to the deterministic renderer." },
    { evidenceId: "EV-SCORE-CONSISTENCY", fact: "Consistency component score is available to the deterministic renderer." },
    ...(factPack.findings ?? []).slice(0, 10).map((finding: Record<string, unknown>) => ({
      evidenceId: finding.evidenceId,
      fact: `${finding.title}; severity ${finding.severity}; affected proportion and count are stored for deterministic rendering.`,
    })),
    ...(factPack.positiveFindings ?? []).slice(0, 3).map((finding: string, index: number) => ({ evidenceId: `EV-POSITIVE-${index + 1}`, fact: finding })),
  ];
  return {
    scope: { state: factPack.scope.state, analysisMode: factPack.scope.analysisMode },
    scoreStatus: factPack.scores.status,
    districtDistribution: factPack.districtDistribution,
    priorityDistricts: (factPack.districts ?? []).slice(0, 12).map((district: Record<string, unknown>) => ({
      district: district.district, priority: district.priority, status: district.status,
      mainFindingEvidenceId: district.mainFindingEvidenceId,
    })),
    evidenceCatalog,
    actionRuleIds: (factPack.actionRules ?? []).map((rule: Record<string, unknown>) => rule.id),
    limitations: factPack.limitations,
  };
}

function validateGrounding(narrative: z.infer<typeof narrativeSchema>, factView: ReturnType<typeof buildFactView>) {
  const validEvidence = new Set(factView.evidenceCatalog.map((item: Record<string, unknown>) => String(item.evidenceId)));
  const validActions = new Set(factView.actionRuleIds.map(String));
  const statements = [...narrative.executiveSummary, ...narrative.keyFindings, ...(narrative.positiveSummary ? [narrative.positiveSummary] : [])];
  for (const item of statements) {
    if (/\d/.test(item.statement)) throw new Error("AI narrative contained a numeric claim; numbers must be rendered deterministically");
    if (/\b(because|caused by|due to|staff shortage|vaccine stock|coverage performance|poor performance)\b/i.test(item.statement)) {
      throw new Error("AI narrative contained an unsupported causal or programme-performance claim");
    }
    if (item.evidenceIds.some((id) => !validEvidence.has(id))) throw new Error("AI narrative cited evidence outside the fact pack");
  }
  if (narrative.highlightedActionRuleIds.some((id) => !validActions.has(id))) {
    throw new Error("AI narrative selected an action outside the approved action library");
  }
}

function estimateUsd(model: string, inputTokens: number, outputTokens: number) {
  const lite = model.toLowerCase().includes("lite");
  const inputRate = lite ? 0.10 : 0.30;
  const outputRate = lite ? 0.40 : 2.50;
  return Math.round(((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000) * 1e8) / 1e8;
}

export const getUwinStateAiStatus = async (req: AuthRequest, res: Response) => {
  res.json({
    enabled: enabled() && Boolean(projectId()),
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    configured: Boolean(projectId()),
  });
};

export const generateUwinStateNarrative = async (req: AuthRequest, res: Response) => {
  if (!enabled() || !projectId()) {
    res.status(503).json({ message: "AI narrative generation is not enabled; the deterministic report remains available" });
    return;
  }
  const reportRef = db.collection("uwinStateReports").doc(req.params.id as string);
  let report: FirebaseFirestore.DocumentSnapshot;
  try {
    report = await reportRef.get();
    const data = report.data();
    if (!report.exists || !canAccessState(req.user, data?.state)) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    if (!["DRAFT", "SAVED"].includes(data?.status)) {
      res.status(409).json({ message: "AI narrative can only be generated for a saved report" });
      return;
    }
    if ((data?.artifacts?.pdf?.storagePath || data?.artifacts?.pdf?.artifactId) && !data?.aiNarrative?.validated) {
      res.status(409).json({ message: "This immutable report version already has a deterministic PDF" });
      return;
    }
    const factView = buildFactView(data?.factPack ?? {});
    const factBytes = Buffer.byteLength(JSON.stringify(factView), "utf8");
    if (factBytes > 30_000) {
      res.status(413).json({ message: "The AI fact view exceeds the configured safety limit" });
      return;
    }
    const fingerprint = hash({ factView, model: MODEL, promptVersion: PROMPT_VERSION });
    if (data?.aiNarrative?.fingerprint === fingerprint && data?.aiNarrative?.validated === true) {
      res.json({ reportId: report.id, cached: true, aiNarrative: data.aiNarrative });
      return;
    }

    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10).replace(/-/g, "");
    const monthKey = now.toISOString().slice(0, 7).replace("-", "");
    const userUsageRef = db.collection("uwinStateAiUsage").doc(`user_${req.user!.id}_${dayKey}`);
    const projectUsageRef = db.collection("uwinStateAiUsage").doc(`project_${monthKey}`);
    await db.runTransaction(async (transaction) => {
      const [freshReport, userUsage, projectUsage] = await Promise.all([
        transaction.get(reportRef), transaction.get(userUsageRef), transaction.get(projectUsageRef),
      ]);
      const generation = freshReport.data()?.aiGeneration;
      const startedAt = generation?.startedAt?.toDate?.()?.getTime?.() ?? 0;
      if (generation?.status === "GENERATING" && Date.now() - startedAt < 120_000) throw new Error("AI_GENERATION_IN_PROGRESS");
      if (Number(userUsage.data()?.reservedCount ?? 0) >= USER_DAILY_LIMIT) throw new Error("AI_USER_LIMIT");
      if (Number(projectUsage.data()?.reservedCount ?? 0) >= PROJECT_MONTHLY_LIMIT) throw new Error("AI_PROJECT_LIMIT");
      transaction.set(userUsageRef, { type: "USER_DAILY", userId: req.user!.id, dayKey, reservedCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(projectUsageRef, { type: "PROJECT_MONTHLY", monthKey, reservedCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.update(reportRef, { aiGeneration: { status: "GENERATING", startedAt: FieldValue.serverTimestamp(), userId: req.user!.id }, updatedAt: FieldValue.serverTimestamp() });
    });

    const ai = new GoogleGenAI({ vertexai: true, project: projectId(), location: LOCATION });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `Create a concise evidence-linked editorial narrative for a state Routine Immunization data quality report. Use only this fact view:\n${JSON.stringify(factView)}`,
      config: {
        systemInstruction: [
          "You edit a government U-WIN data quality report. You do not calculate, diagnose causes, or infer programme performance.",
          "Use only facts in the supplied fact view. Every statement must cite one or more supplied evidence IDs.",
          "Do not write any digits or numeric values; the application inserts all numbers deterministically.",
          "Do not make claims about immunization coverage, vaccine stock, staffing, service performance, or causality.",
          "Select actions only by returning IDs from actionRuleIds. Do not write new actions.",
          "Return JSON matching the required schema and no other text.",
        ].join(" "),
        temperature: 0.2,
        topP: 0.8,
        candidateCount: 1,
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
        responseJsonSchema,
        abortSignal: AbortSignal.timeout(45_000),
        labels: { feature: "uwin-state-report", prompt_version: PROMPT_VERSION },
      },
    });
    if (!response.text) throw new Error("Vertex AI returned no narrative text");
    const narrative = narrativeSchema.parse(JSON.parse(response.text));
    validateGrounding(narrative, factView);
    const usage = response.usageMetadata;
    const promptTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
    const savedNarrative = {
      ...narrative,
      fingerprint,
      validated: true,
      model: response.modelVersion || MODEL,
      requestedModel: MODEL,
      promptVersion: PROMPT_VERSION,
      usage: { promptTokens, outputTokens, totalTokens: usage?.totalTokenCount ?? promptTokens + outputTokens },
      estimatedUsd: estimateUsd(MODEL, promptTokens, outputTokens),
      generatedBy: { id: req.user!.id, email: req.user!.email },
      generatedAt: new Date().toISOString(),
      disclosure: "AI-assisted narrative; all factual claims are linked to deterministic report evidence.",
    };
    await reportRef.update({
      aiNarrative: savedNarrative,
      aiGeneration: { status: "COMPLETED", completedAt: FieldValue.serverTimestamp(), userId: req.user!.id },
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ reportId: report.id, cached: false, aiNarrative: savedNarrative });
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (code === "AI_GENERATION_IN_PROGRESS") { res.status(409).json({ message: "This report already has an AI generation in progress" }); return; }
    if (code === "AI_USER_LIMIT") { res.status(429).json({ message: "Your daily AI report limit has been reached" }); return; }
    if (code === "AI_PROJECT_LIMIT") { res.status(429).json({ message: "The monthly AI report limit has been reached" }); return; }
    console.error("Generate U-WIN State narrative error:", error);
    await reportRef.set({ aiGeneration: { status: "FAILED", failedAt: FieldValue.serverTimestamp(), message: code.slice(0, 500), userId: req.user?.id ?? null }, updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    res.status(502).json({ message: "AI narrative could not be validated; use the deterministic report" });
  }
};

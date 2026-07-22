# U-WIN State report configuration

The U-WIN State report workflow works without AI. It stores an immutable evidence pack, a three-page PDF, report history, progress comparisons, and action tracking.

## Optional Vertex AI narrative

The backend uses Application Default Credentials and never exposes a model credential to the browser. To enable the optional editorial layer:

1. Enable the Vertex AI API for the Firebase project.
2. Grant the Cloud Function runtime service account the minimum Vertex AI User permission required to call the selected model.
3. Set `UWIN_STATE_AI_ENABLED=true` in the Functions environment.
4. Select a supported model with `UWIN_STATE_AI_MODEL`; the code default is `gemini-2.5-flash`.
5. Configure a Google Cloud billing budget and alerts independently of the application limits.

The application sends only a compact report fact view. It does not send raw U-WIN rows, user email addresses, GPS coordinates, beneficiary records, facility records, or session-site records to Gemini.

Every model statement must cite an allowed evidence ID. Numeric and causal statements are rejected, action recommendations are restricted to configured action-rule IDs, and a deterministic report is used whenever generation or validation fails.

## Report workflow

State users can generate drafts, download saved PDFs and district annexes, update report actions, and submit drafts for review. National users and administrators can approve reviewed reports. Approving a newer version automatically marks an older approved version for the same state and period as superseded.

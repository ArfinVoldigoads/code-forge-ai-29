# Code Weaver

Build a completely new AI coding-agent application from scratch. Do not upgrade, patch, or reuse the existing application architecture. Rebuild the entire product with a clean, production-ready architecture, database schema, backend, frontend, authentication, streaming system, sandbox system, and settings pages.

The application is an AI coding workspace similar in concept to v0, but powered by E2B instead of Daytona.

## Core requirements

Use:

- Next.js App Router.

- TypeScript.

- PostgreSQL database.

- Proper server-side persistence.

- Vercel AI SDK latest stable version.

- E2B Code Interpreter/Sandbox SDK.

- Modern responsive UI.

- Desktop and Android mobile support.

- Secure server-side API key handling.

- Real streaming responses.

- Typed APIs and validated inputs.

Do not use:

- Daytona.

- LocalStorage as the primary persistence layer.

- Mock authentication.

- Mock sandbox execution.

- Hardcoded fake AI responses.

- UI-only features without backend implementation.

## Authentication

Implement real authentication with:

- Email and password.

- Secure password hashing.

- Session-based authentication.

- Protected dashboard routes.

- User ownership checks for every chat, file, model, provider, and sandbox.

- Logout.

- Login.

- Registration.

- Password validation.

- Secure cookies.

- Redirect unauthenticated users to login.

## Main application layout

Create a full coding-agent workspace with:

### Desktop layout

- Left sidebar:

  - New chat.

  - Chat history.

  - Search chats.

  - Pinned chats.

  - Delete chat.

  - Rename chat.

  - Settings link.

- Main chat area:

  - Message list.

  - Streaming planning.

  - Streaming thinking.

  - Tool call timeline.

  - Command output.

  - File changes.

  - Final response.

- Bottom composer:

  - Textarea.

  - Upload button.

  - Model selector.

  - Send button.

  - Stop button during generation.

  - Attachment preview.

  - Keyboard shortcuts.

### Mobile layout

- Responsive Android-first layout.

- Hamburger menu.

- Sidebar as drawer.

- New chat button.

- Chat history drawer.

- Settings navigation.

- Composer fixed safely above the mobile keyboard.

- Support 360x520 viewport.

- Proper safe-area padding.

- No horizontal overflow.

- Chat bubbles must remain readable.

## E2B sandbox

E2B must be the only sandbox provider.

Create an E2B Settings page with:

- E2B API key input.

- Secure server-side storage.

- Masked key display.

- Save key.

- Delete key.

- Test connection button.

- Connection status.

- Last test time.

- Error state.

E2B must have full internet access enabled.

The AI must be able to use E2B for:

- Creating sandbox sessions.

- Running shell commands.

- Running Python and JavaScript.

- Installing packages.

- Accessing GitHub.

- Accessing npm.

- Accessing PyPI.

- Accessing public APIs.

- Accessing websites.

- Running Chromium.

- Running Playwright.

- Web research.

- Scraping legal public content.

- Running background processes.

- Exposing preview ports if supported.

Implement E2B tools:

- createSandbox.

- connectSandbox.

- destroySandbox.

- listFiles.

- readFile.

- writeFile.

- editFile.

- deleteFile.

- createDirectory.

- runCommand.

- runBackgroundCommand.

- stopCommand.

- getCommandOutput.

- uploadFile.

- downloadFile.

- searchFiles.

- inspectProject.

- previewService.

- runTests.

- gitDiff.

All E2B commands must:

- Stream output.

- Return structured results.

- Have timeout handling.

- Have cancellation support.

- Validate paths.

- Prevent path traversal.

- Prevent access outside the sandbox workspace.

- Never expose secrets in output or logs.

- Use user/chat ownership checks.

- Use rate limits and resource limits.

Full internet access is required, but add SSRF and secret-exfiltration safeguards where possible.

## AI provider management

Create a Settings section called Providers.

Each provider supports:

- Provider name.

- Provider type.

- API key.

- Base URL.

- Optional organization/project ID.

- Enable/disable.

- Test connection.

- Edit.

- Delete.

- Connection status.

API keys must remain server-side and must never be placed in client bundles or prompts.

Support providers through a provider abstraction so new providers can be added later.

## Model management

Create a separate Settings section called Models.

Models must not be embedded inside provider API-key forms.

Each model supports:

- Display name.

- Model ID.

- Provider.

- Description.

- Context window.

- Vision support.

- Enabled/disabled.

- Default model.

- Sort order.

- Test model.

- Edit.

- Delete.

Allow multiple models per provider.

In the chat interface:

- Add a model selector similar to v0.

- User can select a model before sending.

- Selected model is saved per chat.

- Default model is used automatically.

- Model changes must persist after refresh.

- If selected model fails, show a clear error.

- Do not silently change models without informing the user.

## Real streaming chat

Use the latest Vercel AI SDK streaming APIs.

The server must stream:

- Planning events.

- Thinking events.

- Tool-call start.

- Tool-call arguments.

- Tool execution state.

- Tool results.

- Command output.

- File changes.

- Test results.

- Final assistant response.

- Errors.

- Cancellation state.

The client must render these events live.

Do not wait until the entire AI response completes before showing planning or thinking.

Use typed stream events such as:

- `planning-start`

- `planning-update`

- `thinking-start`

- `thinking-update`

- `tool-start`

- `tool-progress`

- `tool-result`

- `command-output`

- `file-change`

- `test-result`

- `assistant-delta`

- `assistant-finish`

- `error`

- `cancelled`

Each tool event must display:

- Tool name.

- Input summary.

- Running status.

- Output.

- Error if failed.

- Expand/collapse details.

Add:

- Stop generation.

- Retry generation.

- Cancel request.

- Request ID.

- Idempotency protection.

- Proper error recovery.

- Auto-scroll only when user is already at the bottom.

- No duplicate messages on retry.

## Planning behavior

Before changing code, the AI must:

1. Understand the user request.

2. State assumptions.

3. Inspect the project.

4. Inspect relevant files.

5. Inspect database and existing APIs.

6. Consider multiple implementation approaches.

7. Explain tradeoffs.

8. Select the best approach.

9. Create a concrete implementation plan.

10. Identify risks and edge cases.

11. Implement the plan.

12. Run tests and browser verification.

Planning must stream live inside the chat.

## Uploads and multimodal input

Implement full attachment support.

Supported files:

- PNG.

- JPG.

- JPEG.

- WebP.

- GIF.

- PDF.

- TXT.

- MD.

- JSON.

- CSV.

- JS.

- TS.

- TSX.

- JSX.

- Python.

- HTML.

- CSS.

- SQL.

- YAML.

- XML.

- Other source-code files.

Support:

- File picker.

- Drag and drop.

- Multiple attachments.

- Image preview.

- File name.

- File size.

- Remove attachment.

- Upload progress.

- MIME validation.

- File size validation.

- Upload errors.

Store binary content in object/blob storage.

Store only metadata and secure references in PostgreSQL:

- File name.

- MIME type.

- Size.

- Storage path.

- Chat ID.

- Message ID.

- User ID.

- Created timestamp.

- Extracted text if applicable.

AI must be able to:

- Read text files.

- Read source code.

- Analyze images as multimodal input.

- Read PDFs.

- Access uploaded files from E2B.

- Use uploaded files as context for coding tasks.

Never send only the filename to the AI.

## Message editing and retry

Every user message must support:

- Edit.

- Save edited version.

- Cancel editing.

- Resubmit from that point.

- Remove or invalidate later assistant messages.

- Keep revision history.

Every assistant message must support:

- Retry.

- Regenerate.

- Retry with another model.

- Copy.

- Report error.

Persist:

- Parent message ID.

- Revision ID.

- Model ID.

- Request ID.

- Tool calls.

- Tool results.

- Planning.

- Thinking.

- Attachments.

- Error state.

## Agent skills

Create a Skills section in Settings.

Seed the database with these skills:

### Frontend UI

Use semantic HTML, responsive mobile-first layouts, accessibility, design tokens, and browser verification.

### Debugging

Reproduce issues, inspect logs, identify root causes, implement fixes, and rerun verification.

### Testing

Test happy paths, edge cases, errors, mobile layouts, and interactive behavior.

### API Integration

Validate inputs, keep secrets server-side, use parameterized queries, timeouts, retries, and actionable errors.

### Web Research

Use current official documentation, respect robots.txt and terms of service, rate-limit requests, and never bypass access controls.

### Code Review

Review security, authorization, data scoping, performance, error handling, and maintainability.

Each skill must:

- Be stored in the database.

- Have name.

- Have instructions.

- Have enabled state.

- Have sort order.

- Be toggleable in Settings.

- Be dynamically included in the system prompt.

## Database schema

Create a clean production schema for:

- users.

- sessions.

- chats.

- messages.

- message_revisions.

- message_attachments.

- providers.

- models.

- agent_skills.

- sandbox_sessions.

- sandbox_files.

- tool_executions.

- command_outputs.

- audit_logs.

All tables containing user data must include proper ownership or be joined through owned entities.

Every server action and API route must verify:

- Authenticated user.

- Chat ownership.

- Message ownership.

- Attachment ownership.

- Provider/model ownership.

- Sandbox ownership.

Use migrations and indexes.

## Security

Implement:

- Server-side secret storage.

- Secure cookies.

- CSRF protection where needed.

- Parameterized queries.

- Input validation.

- MIME validation.

- File size limits.

- Path traversal prevention.

- Command safety checks.

- SSRF mitigation.

- Rate limiting.

- E2B timeout.

- AI request timeout.

- No secrets in logs.

- No secrets in prompts.

- Security headers.

- Strict ownership checks.

- Audit logging for sandbox commands and tool calls.

## Design direction

Create a distinctive polished developer-tool interface.

Use:

- Dark technical UI.

- Deep charcoal background.

- Slate panels.

- One electric blue primary accent.

- One muted green success accent.

- High-contrast readable text.

- Maximum five total colors.

- Maximum two font families.

- Monospace styling only for code and command output.

- Clean borders.

- Subtle shadows.

- Compact but readable spacing.

- Accessible focus states.

- No decorative blobs.

- No meaningless gradients.

- No emojis as icons.

- Use lucide icons or an existing icon library.

The UI should feel like a professional coding workspace, not a generic dashboard.

## Verification

After building everything:

- Run typecheck.

- Run lint.

- Run production build.

- Run database migration.

- Verify E2B connection.

- Verify provider connection.

- Verify model connection.

- Test chat streaming.

- Test planning streaming.

- Test thinking streaming.

- Test tool execution.

- Test command output.

- Test command failure.

- Test stop generation.

- Test retry.

- Test edit message.

- Test image upload.

- Test PDF upload.

- Test source-code upload.

- Test multimodal AI input.

- Test model switching.

- Test model persistence.

- Test skill enable/disable.

- Test E2B file read/write/delete.

- Test recursive folder deletion.

- Test preview service.

- Test desktop layout.

- Test Android viewport at 360x520.

- Test mobile drawer.

- Test mobile composer.

- Test no horizontal overflow.

- Test auth and ownership boundaries.

Do not claim completion if any feature is only mocked, client-only, or disconnected from the real backend.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://code-forge-ai-29.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/37bb010f-f876-46ad-a222-44fd241e371d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

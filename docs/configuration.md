# Configuration

Settings that live outside the Settings page.

## Follow the system theme

Add this to `User/settings.json` in the app's data folder (see
[Troubleshooting](troubleshooting.md#logs)):

```json
"window.autoDetectColorScheme": true
```

Then pick a theme in Settings once in light mode and once in dark mode.

## Hidden files

Whiteboard collapses files that GitHub Linguist marks as generated or
vendored. To show one, override it in the root `.gitattributes`, or in
`.git/info/attributes` to keep the change local:

```text
**/presentation/external/** linguist-vendored=false
```

`linguist-generated=false` works the same way. Git attributes take precedence
over [Hide files by tag](diffr-configuration.md#display), which sets the hidden
tags for every repository. Reopen the review after you edit either.

## Developer: service URL

To sign in and share against another Whiteboard service, such as staging, add
this to `User/settings.json`:

```json
"review.serviceUrl": "https://stg.dev.fast"
```

Restart Whiteboard, then sign out and in again. The CLI reads
`DEV_REVIEW_SERVICE_ORIGIN`; `whiteboard login --origin` overrides both.

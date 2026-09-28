IMPORTANT: ASK FOR PERMISSION BEFORE EDITING README.md. YOU PROBABLY DON'T NEED TO.

## Testing

Do not add [Change Detector Tests](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html). If you come across one, instead of updating it as part of a change, delete it. Check with the author if it should be replaced, do not assume it should be.

## Imports

In `packages/review` and `packages/review/app`, import through `@review/*` (`packages/review/src`) and `@canvas/*` (`packages/review/app/src`) instead of `../` paths. Keep `./` for siblings.

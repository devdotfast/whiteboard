import { describe, expect, it } from "vitest";

import { reviewDocumentErrorReport } from "./review-document-error-report";

describe("reviewDocumentErrorReport", () => {
  it("captures name, message, and stack from an Error", () => {
    const error = new TypeError("sequence actor exploded");
    const report = reviewDocumentErrorReport(error);
    expect(report.name).toBe("TypeError");
    expect(report.message).toBe("sequence actor exploded");
    expect(report.stack).toContain("sequence actor exploded");
  });

  it("falls back to a stringified value for a non-Error throw", () => {
    const report = reviewDocumentErrorReport("boom");
    expect(report).toEqual({ name: "Error", message: "boom" });
  });
});

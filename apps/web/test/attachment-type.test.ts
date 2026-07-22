import { describe, expect, it } from "vitest";
import { resolveAttachmentType } from "../src/server/deliverables";

// Real 1x1 PNG: sniffing validates the IHDR chunk, not just the signature.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
// ELF header — a Linux executable renamed to look harmless.
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, ...new Array(120).fill(0)]);
// Real ZIP archive (one stored entry) produced by `zip -X`.
const ZIP = Buffer.from(
  "UEsDBAoAAAAAACh19lyGphA2BQAAAAUAAAAFAAAAei50eHRoZWxsb1BLAQIeAwoAAAAAACh19lyGphA2BQAAAAUAAAAFAAAAAAAAAAEAAACkgQAAAAB6LnR4dFBLBQYAAAAAAQABADMAAAAoAAAAAAA=",
  "base64",
);
const TEXT = Buffer.from("provider,status\n1234,verified\n", "utf8");

describe("resolveAttachmentType — trust bytes, not the declared type", () => {
  it("accepts allowed binary types by magic bytes", async () => {
    expect(await resolveAttachmentType(PNG, "image/png")).toBe("image/png");
    expect(await resolveAttachmentType(PDF, "application/pdf")).toBe("application/pdf");
    expect(await resolveAttachmentType(ZIP, "application/zip")).toBe("application/zip");
  });

  it("rejects a zip declared as another allowed binary type", async () => {
    await expect(resolveAttachmentType(ZIP, "application/pdf")).rejects.toThrow(/do not match/);
    await expect(resolveAttachmentType(ZIP, "image/png")).rejects.toThrow(/do not match/);
  });

  it("accepts a zip when the declared type is absent or non-binary", async () => {
    // Browsers sometimes send "" or a generic type; the bytes decide.
    expect(await resolveAttachmentType(ZIP, "")).toBe("application/zip");
    expect(await resolveAttachmentType(ZIP, "application/octet-stream")).toBe("application/zip");
  });

  it("rejects a disallowed binary even when the declared type is allowed", async () => {
    // A renamed executable claiming to be a PDF.
    await expect(resolveAttachmentType(ELF, "application/pdf")).rejects.toThrow(
      /not allowed|do not match/,
    );
  });

  it("rejects a mismatch between declared binary type and actual bytes", async () => {
    await expect(resolveAttachmentType(PNG, "application/pdf")).rejects.toThrow(/do not match/);
  });

  it("accepts real text, and infers csv only when declared", async () => {
    expect(await resolveAttachmentType(TEXT, "text/plain")).toBe("text/plain");
    expect(await resolveAttachmentType(TEXT, "text/csv")).toBe("text/csv");
    // Empty declared type (some browsers) still resolves for text.
    expect(await resolveAttachmentType(TEXT, "")).toBe("text/plain");
  });

  it("rejects unidentifiable binary claiming to be text", async () => {
    const binaryNoise = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0x00, 0x7f]);
    await expect(resolveAttachmentType(binaryNoise, "text/plain")).rejects.toThrow(
      /could not be identified/,
    );
  });
});

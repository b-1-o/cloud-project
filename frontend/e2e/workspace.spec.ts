import { expect, test } from "@playwright/test";

function createTestPdf(): Buffer {
  const stream = "BT /F1 18 Tf 72 720 Td (Scanned test PDF) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + Buffer.byteLength(stream, "ascii") + " >>\nstream\n" + stream + "\nendstream",
  ];
  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output, "ascii"));
    output += (index + 1) + " 0 obj\n" + objects[index] + "\nendobj\n";
  }
  const xrefOffset = Buffer.byteLength(output, "ascii");
  output += "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets) output += String(offset).padStart(10, "0") + " 00000 n \n";
  output += "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF";
  return Buffer.from(output, "ascii");
}

test("creates a document and exposes the editor toolbar", async ({ page }) => {
  await page.route("**/api/documents", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          document: {
            id: "playwright-document",
            title: "Untitled document",
            updated_at: new Date().toISOString(),
            role: "owner",
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documents: [] }),
    });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /recently used/i })).toBeVisible();
  await expect(page.locator(".workspace-hub-section")).toHaveCount(0);
  await page.locator(".new-doc").first().click();
  await expect(page.getByRole("textbox", { name: "Document title" })).toHaveValue("Untitled document");
  await expect(page.getByRole("button", { name: "Bold", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Heading 1" })).toBeVisible();
});


test("keeps Workspace Hub separate from the Recently Used home", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        documents: [{
          id: "e2e-dashboard-doc",
          title: "Product notes",
          updated_at: new Date().toISOString(),
          role: "owner",
        }],
      }),
    });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /recently used/i })).toBeVisible();
  await expect(page.locator(".workspace-hub-section")).toHaveCount(0);
  await expect(page.locator(".dashboard-recent-item").filter({ hasText: "Product notes" })).toHaveCount(1);
  await expect(page.locator(".gmail-inbox-panel")).toBeVisible();

  await page.locator(".workspace-hub-nav").click();
  await expect(page.getByRole("heading", { name: /workspace hub/i })).toBeVisible();
  await expect(page.locator(".workspace-hub-section")).toBeVisible();
  await expect(page.locator(".workspace-hub-card")).toHaveCount(5);
  await expect(page.locator(".workspace-stats-sidebar")).toBeVisible();
  await expect(page.locator(".workspace-stats-sidebar")).toContainText("Workspace pulse");
  await expect(page.locator(".dashboard-recent")).toHaveCount(0);
  await expect(page.locator(".gmail-inbox-panel")).toHaveCount(0);

  await page.locator(".personal-workspace-nav").click();
  await expect(page.getByRole("heading", { name: /recently used/i })).toBeVisible();
  await expect(page.locator(".dashboard-recent-item").filter({ hasText: "Product notes" })).toHaveCount(1);
  await expect(page.locator(".workspace-hub-section")).toHaveCount(0);
});


test("imports scanned PDFs as the original file without requiring OCR", async ({ page }) => {
  const pdfBytes = createTestPdf();
  await page.route(/\/api\/documents(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ document: {
          id: "e2e-scanned-pdf",
          title: "scanned-contract",
          updated_at: new Date().toISOString(),
          role: "owner",
        } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [] }) });
  });
  await page.route("**/api/documents/e2e-scanned-pdf/file", async (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().headers()["content-type"]).toBe("application/pdf");
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (route.request().method() === "HEAD") {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-length": String(pdfBytes.byteLength),
          "x-document-file-name": encodeURIComponent("scanned-contract.pdf"),
        },
      });
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/pdf", body: pdfBytes });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });

  await page.goto("/");
  await page.locator('input[type="file"][aria-label="Choose a document to import"]').setInputFiles({
    name: "scanned-contract.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes,
  });

  await expect(page.locator(".original-file-workspace")).toBeVisible();
  await expect(page.locator(".pdf-page-surface")).toBeVisible();
  await expect(page.locator(".original-file-pdf-frame")).toHaveCount(0);
  await expect(page.locator(".pdf-page-count")).toHaveText("1 page");
  await expect(page.getByRole("link", { name: "Download original" })).toBeVisible();

  await page.getByRole("button", { name: "Signature" }).click();
  await expect(page.getByRole("dialog", { name: "Draw your signature" })).toBeVisible();
  const pad = page.locator(".signature-canvas");
  const padBox = await pad.boundingBox();
  if (!padBox) throw new Error("Signature canvas is not visible");
  await page.mouse.move(padBox.x + 65, padBox.y + 145);
  await page.mouse.down();
  await page.mouse.move(padBox.x + 180, padBox.y + 85, { steps: 8 });
  await page.mouse.move(padBox.x + 285, padBox.y + 150, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Insert signature" }).click();

  const pageLayer = page.locator(".pdf-markup-layer").first();
  const pageBox = await pageLayer.boundingBox();
  if (!pageBox) throw new Error("PDF page markup layer is not visible");
  await page.mouse.click(pageBox.x + pageBox.width * 0.35, pageBox.y + pageBox.height * 0.42);
  const signatureMark = page.locator('.pdf-mark-item[data-mark-type="image"]');
  await expect(signatureMark).toHaveCount(1);
  const initialX = Number(await signatureMark.getAttribute("data-x"));

  const signatureBox = await signatureMark.boundingBox();
  if (!signatureBox) throw new Error("Placed signature is not selectable");
  await page.mouse.move(signatureBox.x + signatureBox.width / 2, signatureBox.y + signatureBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(signatureBox.x + signatureBox.width / 2 + 28, signatureBox.y + signatureBox.height / 2 + 18, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await signatureMark.getAttribute("data-x"))).toBeGreaterThan(initialX);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => Number(await signatureMark.getAttribute("data-x"))).toBeCloseTo(initialX, 3);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => Number(await signatureMark.getAttribute("data-x"))).toBeGreaterThan(initialX);

  const resizeHandle = page.locator('.pdf-resize-handle[data-resize-handle="true"]');
  const handleBox = await resizeHandle.boundingBox();
  if (!handleBox) throw new Error("Signature resize handle is not visible");
  const widthBeforeResize = Number(await signatureMark.getAttribute("data-width"));
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 34, handleBox.y + handleBox.height / 2 + 24, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await signatureMark.getAttribute("data-width"))).toBeGreaterThan(widthBeforeResize);

  await page.getByRole("button", { name: "Add text" }).click();
  await page.getByRole("textbox", { name: "Text to place" }).fill("Reviewed and approved");
  const textPageBox = await pageLayer.boundingBox();
  if (!textPageBox) throw new Error("PDF page is not visible for text placement");
  await page.mouse.click(textPageBox.x + textPageBox.width * 0.54, textPageBox.y + textPageBox.height * 0.54);
  await expect(page.locator('.pdf-mark-item[data-mark-type="text"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Checkbox" }).click();
  const checkboxPageBox = await pageLayer.boundingBox();
  if (!checkboxPageBox) throw new Error("PDF page is not visible for checkbox placement");
  await page.mouse.click(checkboxPageBox.x + checkboxPageBox.width * 0.62, checkboxPageBox.y + checkboxPageBox.height * 0.62);
  const checkboxMark = page.locator('.pdf-mark-item[data-mark-type="checkbox"]');
  await expect(checkboxMark).toHaveCount(1);
  await page.getByRole("button", { name: "Check" }).click();

  const saveButton = page.getByRole("button", { name: /save pdf/i });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.locator(".pdf-saved-status")).toBeVisible();
});


test("requires a continuous hold before moving a document to trash", async ({ page }) => {
  let deleteRequested = false;
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        documents: [{
          id: "e2e-hold-doc",
          title: "Hold test document",
          updated_at: new Date().toISOString(),
          role: "owner",
        }],
      }),
    });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });
  await page.route("**/api/documents/e2e-hold-doc", async (route) => {
    if (route.request().method() === "DELETE") {
      deleteRequested = true;
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fallback();
  });

  await page.goto("/");
  const documentRow = page.locator(".document-item").filter({ hasText: "Hold test document" });
  await expect(documentRow).toBeVisible();
  await documentRow.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: /move to trash/i }).click();
  const holdButton = page.getByRole("button", { name: /hold to move to trash/i });
  await expect(holdButton).toBeVisible();

  await holdButton.click();
  expect(deleteRequested).toBe(false);

  await holdButton.hover();
  await page.mouse.down();
  await page.waitForTimeout(2150);
  await page.mouse.up();
  await expect.poll(() => deleteRequested, { timeout: 5000 }).toBe(true);
});


test("Mine view hides the All dashboard and uses a compact document view", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [] }) });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });

  await page.goto("/");
  await page.locator(".workspace-nav").getByRole("button", { name: "Mine" }).click();
  await expect(page.getByRole("heading", { name: /your documents/i })).toBeVisible();
  await expect(page.locator(".workspace-hub-section")).toHaveCount(0);
  await expect(page.locator(".workspace-stats-sidebar")).toHaveCount(0);
  await expect(page.locator(".smart-folder-card")).toHaveCount(0);
  await expect(page.locator(".filtered-documents-empty")).toBeVisible();
});

test("calendar opens a real navigable month grid", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [{
      id: "e2e-calendar-doc", title: "Calendar test", updated_at: new Date().toISOString(), role: "owner",
    }] }) });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });

  await page.goto("/");
  await page.locator(".workspace-hub-nav").click();
  await page.locator(".workspace-hub-card.hub-calendar").click();
  await expect(page.locator(".workspace-calendar-grid")).toBeVisible();
  await expect(page.locator(".workspace-calendar-day")).toHaveCount(42);
  await expect(page.locator(".calendar-workspace-title h3")).toContainText(/January|February|March|April|May|June|July|August|September|October|November|December/);
  const monthBefore = await page.locator(".calendar-workspace-title h3").innerText();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.locator(".calendar-workspace-title h3")).not.toHaveText(monthBefore);
});


test("calendar creates events with reminders, links, email, and a document attachment", async ({ page }) => {
  let storedEvents: Array<Record<string, unknown>> = [];
  await page.route(/\/api\/documents(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documents: [{
        id: "e2e-calendar-doc",
        title: "Calendar test document",
        updated_at: new Date().toISOString(),
        role: "owner",
      }] }),
    });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });
  await page.route("**/api/calendar/events**", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      const event = {
        id: "e2e-calendar-event",
        ...payload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storedEvents = [event];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ event }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: storedEvents }) });
  });

  await page.goto("/");
  await page.locator(".workspace-hub-nav").click();
  await page.locator(".workspace-hub-card.hub-calendar").click();
  await page.getByRole("button", { name: /new event/i }).click();
  await page.getByRole("textbox", { name: "Event title" }).fill("Planning session");
  await page.getByRole("textbox", { name: "Description / notes" }).fill("Review this week's work.");
  await page.getByRole("textbox", { name: "Link" }).fill("https://example.com/meeting");
  await page.getByRole("textbox", { name: "Email invite" }).fill("teammate@example.com");
  await page.getByLabel("Reminder").selectOption("15");
  await page.getByLabel("Attach document").selectOption("e2e-calendar-doc");
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page.locator(".calendar-event-card")).toContainText("Planning session");
  await expect(page.locator(".calendar-event-card")).toContainText("15 min before");
  await expect(page.getByRole("link", { name: "Email teammate@example.com" })).toHaveAttribute("href", /mailto:/);
  await expect(page.getByRole("link", { name: "Open event link" })).toHaveAttribute("href", "https://example.com/meeting");
  await expect(page.getByRole("link", { name: "Open attached document Calendar test document" })).toHaveAttribute("href", "/?doc=e2e-calendar-doc");
  expect(storedEvents).toHaveLength(1);
});

test("workspace comments shortcut opens a real document comments panel", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [{
      id: "e2e-comment-doc", title: "Discussion document", updated_at: new Date().toISOString(), role: "owner",
    }] }) });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });
  await page.route("**/api/documents/e2e-comment-doc/comments", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ comments: [] }) });
  });

  await page.goto("/");
  await page.locator(".workspace-hub-nav").click();
  await page.getByTestId("workspace-hub-comments").click();
  await expect(page.getByRole("complementary", { name: "Comments" })).toBeVisible();
  await expect(page.getByText("No comments yet.")).toBeVisible();
});



test("clicking a recently used document opens its editor", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [{
      id: "e2e-folder-doc", title: "Design brief", updated_at: new Date().toISOString(), role: "owner",
    }] }) });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });
  await page.goto("/");
  await expect(page.locator(".dashboard-recent-item").filter({ hasText: "Design brief" })).toBeVisible();
  await page.locator(".dashboard-recent-item").filter({ hasText: "Design brief" }).click();
  await expect(page.getByRole("textbox", { name: "Document title" })).toHaveValue("Design brief");
});


test("workspace breadcrumbs and quick navigation leave the active document", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documents: [{
        id: "e2e-navigation-doc",
        title: "Navigation test document",
        updated_at: new Date().toISOString(),
        role: "owner",
      }] }),
    });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /recently used/i })).toBeVisible();
  await page.locator(".document-item").filter({ hasText: "Navigation test document" }).locator(".document-link").click();
  await expect(page.getByRole("textbox", { name: "Document title" })).toHaveValue("Navigation test document");
  await page.locator(".workspace-nav").getByRole("button", { name: "All" }).click();
  await expect(page.getByRole("heading", { name: /recently used/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Document title" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/doc=e2e-navigation-doc/);
});

test("Ctrl/Command+K follows the physical key across keyboard layouts", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [] }) });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });
  await page.goto("/");
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "л", code: "KeyK", ctrlKey: true, bubbles: true, cancelable: true,
    }));
  });
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Command search" })).toBeVisible();
});

test("theme switches smoothly between light and dark", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [] }) });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });
  await page.goto("/");
  const before = await page.locator("html").evaluate((element) => element.classList.contains("dark"));
  await page.getByRole("button", { name: /toggle color theme/i }).click();
  await expect.poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(!before);
});


test("read-only document viewers can still post comments", async ({ page }) => {
  let postReceived = false;
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documents: [{
        id: "e2e-viewer-doc",
        title: "Shared read-only notes",
        updated_at: new Date().toISOString(),
        role: "viewer",
      }] }),
    });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });
  await page.route("**/api/documents/e2e-viewer-doc/comments", async (route) => {
    if (route.request().method() === "POST") {
      postReceived = JSON.parse(route.request().postData() || "{}").body === "A useful note";
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ comment: { id: "comment-1", body: "A useful note" } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ comments: [] }) });
  });

  await page.goto("/");
  await page.locator(".workspace-hub-nav").click();
  await page.getByTestId("workspace-hub-comments").click();
  await expect(page.getByRole("complementary", { name: "Comments" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Comment text" })).toBeVisible();
  await page.getByRole("textbox", { name: "Comment text" }).fill("A useful note");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect.poll(() => postReceived).toBe(true);
});

import { expect, test } from "@playwright/test";

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
  await expect(page.getByRole("heading", { name: /make room for\s+good ideas/i })).toBeVisible();
  await page.getByRole("button", { name: /create document/i }).click();
  await expect(page.getByRole("textbox", { name: "Document title" })).toHaveValue("Untitled document");
  await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Heading 1" })).toBeVisible();
});


test("shows live workspace statistics and working smart folders", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          document: {
            id: "e2e-dashboard-doc",
            title: "Product notes",
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
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /workspace hub/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /all documents/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /favorites/i })).toBeVisible();
  await expect(page.locator(".smart-folder-card .folder-root")).toHaveCount(4);
  await expect(page.locator(".dashboard-document-card").filter({ hasText: "Product notes" })).toBeVisible();

  await page.getByRole("button", { name: /favorites folder/i }).click();
  await expect(page.getByRole("heading", { name: "Your favorites." })).toBeVisible();
  await expect(page.getByText("Nothing saved yet")).toBeVisible();

  await page.getByRole("button", { name: /templates/i }).click();
  await expect(page.getByRole("dialog")).toContainText("Start from a template");
  await expect(page.locator(".template-option-icon svg")).toHaveCount(4);
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


test("empty smart folders contain no synthetic document pages", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [] }) });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^mine$/i }).click();
  await expect(page.getByRole("heading", { name: /your documents/i })).toBeVisible();
  await expect(page.locator(".smart-folder-card .folder-root")).toHaveCount(4);
  await expect(page.locator(".smart-folder-card .folder-item")).toHaveCount(0);
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
  await page.locator(".workspace-hub-card.hub-calendar").click();
  await expect(page.locator(".workspace-calendar-grid")).toBeVisible();
  await expect(page.locator(".workspace-calendar-day")).toHaveCount(42);
  const monthBefore = await page.locator(".workspace-calendar-header h3").innerText();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.locator(".workspace-calendar-header h3")).not.toHaveText(monthBefore);
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
  await page.getByTestId("workspace-hub-comments").click();
  await expect(page.getByRole("complementary", { name: "Comments" })).toBeVisible();
  await expect(page.getByText("No comments yet.")).toBeVisible();
});


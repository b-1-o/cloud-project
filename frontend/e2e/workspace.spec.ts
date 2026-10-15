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
  await expect(page.getByRole("heading", { name: /workspace at a glance/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /all documents/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /favorites/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /product notes/i })).toBeVisible();

  await page.getByRole("button", { name: /favorites/i }).click();
  await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
  await expect(page.getByText("Nothing saved yet")).toBeVisible();
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

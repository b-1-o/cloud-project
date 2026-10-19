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
  await expect(page.getByRole("heading", { name: /quick actions/i })).toBeVisible();
  await expect(page.locator(".workspace-stats-sidebar")).toBeVisible();
  await expect(page.locator(".workspace-stats-sidebar")).toContainText("Workspace pulse");
  await expect(page.locator(".smart-folder-card .folder-doc-text").filter({ hasText: "Product notes" })).toHaveCount(2);

  await page.getByRole("button", { name: /favorites folder/i }).click();
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /quick actions/i })).toBeVisible();
  await expect(page.locator(".smart-folder-card .folder-root[data-open]")).toHaveCount(1);

  await page.locator(".workspace-action-card").filter({ hasText: "Templates" }).click();
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
  await expect(page.locator(".calendar-workspace-title h3")).toContainText(/January|February|March|April|May|June|July|August|September|October|November|December/);
  const monthBefore = await page.locator(".calendar-workspace-title h3").innerText();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.locator(".calendar-workspace-title h3")).not.toHaveText(monthBefore);
});


test("calendar creates events with reminders, links, email, and a document attachment", async ({ page }) => {
  let storedEvents: Array<Record<string, unknown>> = [];
  await page.route("**/api/documents**", async (route) => {
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
  await page.getByTestId("workspace-hub-comments").click();
  await expect(page.getByRole("complementary", { name: "Comments" })).toBeVisible();
  await expect(page.getByText("No comments yet.")).toBeVisible();
});



test("clicking a sheet opens its document without navigating on folder open", async ({ page }) => {
  await page.route(/\/api\/documents\?.*$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [{
      id: "e2e-folder-doc", title: "Design brief", updated_at: new Date().toISOString(), role: "owner",
    }] }) });
  });
  await page.route("**/api/documents/*/ticket", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test offline"}' });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "All documents folder" }).click();
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  await expect(page.locator(".smart-folder-card .folder-root[data-open]")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Document title" })).toHaveCount(0);
  await page.locator(".smart-folder-card .folder-root[data-open] .folder-item").first().click();
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
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  await page.getByRole("button", { name: /Navigation test document/ }).click();
  await expect(page.getByRole("textbox", { name: "Document title" })).toHaveValue("Navigation test document");
  await page.getByRole("button", { name: "Workspace All" }).click();
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
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
  await page.getByRole("button", { name: /switch to (light|dark) theme/i }).click();
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
  await page.getByTestId("workspace-hub-comments").click();
  await expect(page.getByRole("complementary", { name: "Comments" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Comment text" })).toBeVisible();
  await page.getByRole("textbox", { name: "Comment text" }).fill("A useful note");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect.poll(() => postReceived).toBe(true);
});

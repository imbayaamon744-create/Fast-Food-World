import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { managementApi } from "./management-fixture.js";

async function screenshot(page: import("@playwright/test").Page, name:string, width:string) {
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
  await mkdir(".local/screenshots",{recursive:true});
  await page.screenshot({path:".local/screenshots/"+name+"-"+width+".png",fullPage:true});
}
async function login(page: import("@playwright/test").Page) {
  await page.goto("/admin.html");
  await page.getByLabel("Email",{exact:true}).fill("owner@example.invalid");
  await page.getByLabel("Password",{exact:true}).fill("Fixture password only");
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page.locator("#dashboard")).toBeVisible();
  await expect(page.locator("#admin-message")).toHaveText("Dashboard up to date.");
}
test("dedicated story and contact pages and navbar destinations", async ({page}, info) => {
  const state = await managementApi(page);
  state.settings.phone = "0712345678";
  state.settings.email = "hello@example.invalid";
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#story, #contact")).toHaveCount(0);
  await screenshot(page, "home", info.project.name);
  async function navigate(label: string, destination: RegExp) {
    const toggle = page.getByRole("button", {name: "Menu", exact: true});
    if (page.viewportSize()!.width < 768) {
      await expect(toggle).toBeVisible();
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }
    await page.locator(".site-links").getByRole("link", {name: label, exact: true}).click();
    await expect(page).toHaveURL(destination);
    if (await toggle.isVisible()) await expect(toggle).toHaveAttribute("aria-expanded", "false");
  }
  await navigate("Menu", /menu.html$/);
  await expect(page.locator(".site-links a[aria-current=page]")).toHaveText("Menu");
  await expect(page.locator(".product-card")).toContainText("Beef Samosa");
  await navigate("Catering", /catering.html$/);
  await expect(page.getByLabel("Event date", {exact: true})).toBeVisible();
  await navigate("Our story", /story.html$/);
  await expect(page.locator("h1")).toContainText("Good food starts");
  await expect(page.locator(".site-links a[aria-current=page]")).toHaveText("Our story");
  await page.locator("#story").scrollIntoViewIfNeeded();
  const images = page.locator(".landing-story-photos img");
  await expect(images).toHaveCount(2);
  for (const image of await images.all()) {
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  const first = (await images.nth(0).boundingBox())!;
  const second = (await images.nth(1).boundingBox())!;
  expect(Math.abs(first.y - second.y)).toBeLessThan(1);
  expect(Math.abs(first.height - second.height)).toBeLessThan(1);
  expect(Math.abs(first.width - second.width)).toBeLessThan(1);
  await screenshot(page, "story", info.project.name);
  await navigate("Contact", /contact.html$/);
  await expect(page.locator("h1")).toContainText("Stop by");
  await expect(page.locator(".site-links a[aria-current=page]")).toHaveText("Contact");
  await expect(page.locator('a[href="tel:0712345678"]')).toBeVisible();
  await expect(page.locator('a[href="mailto:hello@example.invalid"]')).toBeVisible();
  await expect(page.locator("[data-map-link]")).toHaveAttribute("href", /China%20Square/);
  await screenshot(page, "contact", info.project.name);
  await expect(page.locator("[data-setting=address]")).toContainText("Nairobi");
  await navigate("Order online", /order.html$/);
  await expect(page.getByRole("button", {name: "Add Beef Samosa to basket", exact: true})).toBeVisible();
  await navigate("Home", /index.html$/);
  expect(errors).toEqual([]);
});

test("browse menu prices, search, category, availability and sorting before ordering", async ({page}, info) => {
  const state = await managementApi(page);
  const original = state.items[0]!;
  state.items.push({...original, id: "10000000-0000-4000-8000-000000000002", name: "Potato Bhajias", priceMinor: 10000, category: {...original.category, name: "Sides", slug: "sides"}},
    {...original, id: "10000000-0000-4000-8000-000000000003", name: "Apple Juice", priceMinor: 8000, available: false});
  await page.goto("/menu.html");
  const cards = page.locator(".product-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText("50.00");
  await expect(page.getByRole("button", {name: /Add .* to basket/})).toHaveCount(0);
  await page.getByRole("combobox", {name: "Sort by", exact: true}).selectOption("price-desc");
  await expect(cards.locator("h3")).toHaveText(["Potato Bhajias", "Apple Juice", "Beef Samosa"]);
  await page.getByRole("combobox", {name: "Sort by", exact: true}).selectOption("price-asc");
  await expect(cards.locator("h3")).toHaveText(["Beef Samosa", "Apple Juice", "Potato Bhajias"]);
  await page.getByRole("combobox", {name: "Sort by", exact: true}).selectOption("name");
  await expect(cards.locator("h3")).toHaveText(["Apple Juice", "Beef Samosa", "Potato Bhajias"]);
  await page.getByLabel("Available only", {exact: true}).check();
  await expect(cards).toHaveCount(2);
  await page.getByRole("combobox", {name: "Category", exact: true}).selectOption("sides");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Potato Bhajias");
  await page.getByLabel("Search menu", {exact: true}).fill("does not exist");
  await expect(page.locator("[data-menu-message]")).toContainText("No matching items");
  await page.getByLabel("Search menu", {exact: true}).fill("");
  await page.getByRole("combobox", {name: "Category", exact: true}).selectOption("");
  await screenshot(page, "browse-menu", info.project.name);
  expect(await page.evaluate(() => localStorage.getItem("restaurant.basket.v1"))).toBeNull();
  await page.getByRole("link", {name: "Start an order", exact: true}).click();
  await expect(page).toHaveURL(/order.html$/);
  await page.getByRole("combobox", {name: "Sort by", exact: true}).selectOption("price-desc");
  await expect(page.locator(".product-card h3").first()).toHaveText("Potato Bhajias");
  await page.getByRole("button", {name: "Add Beef Samosa to basket", exact: true}).click();
  await expect(page.locator("#cart-items")).toContainText("Beef Samosa");
});

test("landing works without API and menu can recover after a failure", async ({page}) => {
  await page.route("**/api/**", route => route.abort("failed"));
  await page.goto("/");
  await expect(page.getByRole("link", {name: "View the full menu", exact: true})).toHaveAttribute("href", "menu.html");
  await expect(page.locator("[data-map-link]")).toBeHidden();
  await page.getByRole("link", {name: "View the full menu", exact: true}).click();
  await expect(page.locator("[data-menu-message]")).toContainText("temporarily unavailable");
  await page.unroute("**/api/**");
  await managementApi(page);
  await page.getByRole("button", {name: "Reload menu", exact: true}).click();
  await expect(page.locator(".product-card")).toContainText("Beef Samosa");
});

test("admin sign-in, summary, order details, transitions, menu, settings, quote and logout",async({page},info)=>{
  const state=await managementApi(page);
  const errors:string[]=[]; page.on("pageerror",e=>errors.push(e.message));
  state.catering.push({id:state.orders[0]!.id,customerName:"Event Guest",phone:"0712345678",eventDate:"2099-12-01",guestCount:30,package:"Classic",location:"Nairobi",status:"PENDING",adminNotes:null,quoteMinor:null});
  await login(page);
  await screenshot(page,"admin-orders",info.project.name);
  await page.getByRole("button",{name:/View order/}).click();
  await expect(page.locator(".admin-detail")).toContainText("Review Guest");
  await expect(page.getByLabel("Next status")).toHaveValue("PREPARING");
  await page.getByRole("button",{name:"Update order status",exact:true}).click();
  await expect.poll(()=>state.orders[0]!.status).toBe("PREPARING");
  await page.getByRole("button",{name:"Menu & categories",exact:true}).click();
  await page.locator("summary").filter({hasText:/Beef Samosa/}).click();
  await page.getByLabel("Price (KSh)",{exact:true}).last().fill("55.25");
  await page.getByLabel("Image reference", {exact:false}).last().fill("javascript:alert(1)");
  await page.getByRole("button",{name:"Save item",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Check submitted fields");
  await page.getByLabel("Image reference", {exact:false}).last().fill("");
  await page.getByLabel("Available",{exact:true}).last().uncheck();
  await page.getByRole("button",{name:"Save item",exact:true}).click();
  await expect.poll(()=>state.items[0]!.priceMinor).toBe(5525);expect(state.items[0]!.available).toBe(false);
  await page.getByRole("button",{name:"Restaurant settings",exact:true}).click();
  await page.getByLabel("Restaurant name",{exact:true}).fill("Updated Restaurant");
  await page.getByRole("button",{name:"Save restaurant settings",exact:true}).click();
  await expect.poll(()=>state.settings.name).toBe("Updated Restaurant");
  await screenshot(page,"admin-settings",info.project.name);
  await page.getByRole("button",{name:"Catering requests",exact:true}).click();
  await page.getByLabel("Internal notes").fill("Discuss access");
  await page.getByLabel("Optional quote (KSh)").fill("12500.50");
  await page.getByRole("combobox",{name:"Request status",exact:true}).selectOption("CONFIRMED");
  await page.getByRole("button",{name:"Save catering request",exact:true}).click();
  await expect.poll(()=>state.catering[0].quoteMinor).toBe(1250050);
  await screenshot(page,"admin-catering",info.project.name);
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.locator("#login-panel")).toBeVisible();
  await expect(page.locator("#admin-content")).toBeEmpty();
  await screenshot(page,"admin-login",info.project.name);
  expect(errors).toEqual([]);
});
test("admin invalid login, empty filters, failure state and expired session hide private data",async({page})=>{
  const state=await managementApi(page);state.failLogin=true;
  await page.goto("/admin.html");
  await page.getByLabel("Email",{exact:true}).fill("owner@example.invalid");
  await page.getByLabel("Password",{exact:true}).fill("Incorrect");
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect");
  state.failLogin=false;
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page.locator("#admin-message")).toHaveText("Dashboard up to date.");
  await page.getByLabel("Filter by status").selectOption("COMPLETED");
  await page.getByRole("button",{name:"Apply filter",exact:true}).click();
  await expect(page.locator("#admin-content")).toContainText("No orders match");
  state.failLoad=true;await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  state.failLoad=false;state.authenticated=false;
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await expect(page.locator("#dashboard")).toBeHidden();await expect(page.locator("#admin-content")).toBeEmpty();
});
test("catering dates, preserved inputs, exact retry after lost receipt and saved-only confirmation",async({page},info)=>{
  const state=await managementApi(page);
  await page.goto("/catering.html");
  await page.getByLabel("Your name",{exact:true}).fill("Catering Guest");
  await page.getByLabel("Phone number",{exact:true}).fill("0712345678");
  await page.getByLabel("Event date",{exact:true}).fill("2099-12-01");
  await page.getByLabel("Event location",{exact:true}).fill("Nairobi");
  await page.getByLabel("Number of guests",{exact:true}).fill("30");
  await page.locator("#catering-package").selectOption("Classic");
  await expect(page.locator("#event-day")).not.toHaveValue("");
  await screenshot(page,"catering-form",info.project.name);
  state.loseCatering=true;
  await page.getByRole("button",{name:"Send catering request",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("unconfirmed");
  await expect(page.locator("#booking-result")).toBeHidden();
  await expect(page.getByLabel("Your name",{exact:true})).toHaveValue("Catering Guest");
  await expect(page.getByLabel("Your name",{exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Retry same request",exact:true}).click();
  await expect(page.locator("#booking-result")).toContainText("not a confirmed booking");
  expect(state.catering).toHaveLength(1);expect(state.attempts[1]).toEqual(state.attempts[0]);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain("Catering Guest");
  await screenshot(page,"catering-receipt",info.project.name);
});

test("optional image failure, availability filtering, reduced motion and navigation fallback",async({page, browser},info)=>{
  const state=await managementApi(page);
  state.items[0]!.available=false;
  state.items[0]!.imageUrl="https://images.example.invalid/missing.png";
  await page.route("https://images.example.invalid/**",route=>route.abort());
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/order.html");
  await expect(page.locator(".product-card")).toBeVisible();
  await expect(page.locator(".product-card img")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Beef Samosa is unavailable",exact:true})).toBeDisabled();
  await page.getByLabel("Available only",{exact:true}).check();
  await expect(page.locator("[data-menu-message]")).toContainText("No matching items");
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  await page.getByLabel("Available only",{exact:true}).uncheck();
  await screenshot(page,"menu-unavailable",info.project.name);
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:844}});
  const fallback=await context.newPage();
  try {
    await fallback.goto("http://127.0.0.1:4173/order.html");
    await expect(fallback.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:"Catering",exact:true})).toBeVisible();
  } finally { await context.close(); }
});

test("admin category and menu creation preserve values on failure",async({page})=>{
  const state=await managementApi(page);
  await login(page);
  await page.getByRole("button",{name:"Menu & categories",exact:true}).click();
  await page.getByText("Add category",{exact:true}).click();
  const categoryForm=page.locator("details").filter({has:page.locator("summary",{hasText:"Add category"})}).locator("form");
  await categoryForm.getByLabel("Category name",{exact:true}).fill("Drinks");
  await categoryForm.getByLabel("Category slug",{exact:true}).fill("drinks");
  await categoryForm.getByRole("button",{name:"Create category",exact:true}).click();
  await expect.poll(()=>state.categories.length).toBe(2);
  await page.getByText("Add menu item",{exact:true}).click();
  const itemForm=page.locator("details").filter({has:page.locator("summary",{hasText:"Add menu item"})}).locator("form");
  await itemForm.getByLabel("Item name",{exact:true}).fill("Chai");
  await itemForm.getByLabel("Item slug",{exact:true}).fill("chai");
  await itemForm.getByLabel("Description",{exact:true}).fill("Spiced tea.");
  await itemForm.getByRole("combobox",{name:"Category",exact:true}).selectOption(state.categories[1]!.id);
  await itemForm.getByLabel("Price (KSh)",{exact:true}).fill("80");
  await itemForm.getByRole("button",{name:"Create item",exact:true}).click();
  await expect.poll(()=>state.items.length).toBe(2);
  expect(state.items[1]!.priceMinor).toBe(8000);expect(state.items[1]!.imageUrl).toBeNull();
});

test("contact page keeps useful information when settings cannot load", async ({page}) => {
  await page.route("**/api/settings", route => route.abort("failed"));
  await page.goto("/contact.html");
  await expect(page.locator("h1")).toContainText("Stop by");
  await expect(page.locator("[data-contact]")).toContainText("phone and email will be published");
  await expect(page.locator("[data-map-link]")).toBeHidden();
  await expect(page.getByRole("link", {name: "Ask about catering", exact: true})).toHaveAttribute("href", "catering.html");
});

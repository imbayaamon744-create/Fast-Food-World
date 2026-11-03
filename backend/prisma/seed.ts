import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createDatabase, type Database } from "../server/db.js";

const catalog = [
  { slug: "samosas", name: "Signature Samosas", items: [
    ["beef-samosa", "Beef Samosa", "Crispy pastry filled with spiced minced beef and herbs.", 50],
    ["chicken-samosa", "Chicken Samosa", "Pastry filled with seasoned chicken.", 60],
    ["veggie-samosa", "Vegetable Samosa", "Crispy pastry with spiced potatoes and peas.", 80],
    ["crispy-chicken-samosa", "Crispy Chicken Samosa", "A crisp chicken samosa snack.", 80],
  ] },
  { slug: "snacks", name: "Snacks & Treats", items: [
    ["bhajias", "Crispy Potato Bhajias", "Sliced potatoes dipped in spiced gram flour batter.", 100],
    ["spring-rolls", "Spring Rolls", "Golden fried rolls filled with vegetables.", 80],
    ["sausage", "Sausage", "Hot grilled sausage.", 70],
    ["smokie-bites", "Sausages & Smokie Bites", "Sausage and smokie bites with kachumbari salsa.", 100],
  ] },
  { slug: "fast-food", name: "Fast Food", items: [
    ["beef-burger", "Beef Burger", "Beef patty served in a bun.", 350],
    ["chips", "Chips", "Golden fried potato fries.", 150],
    ["fried-chicken", "Fried Chicken", "Crispy seasoned fried chicken.", 400],
  ] },
  { slug: "drinks", name: "Drinks", items: [
    ["soda", "Chilled Soda", "A chilled soft drink.", 80],
    ["fresh-juice", "Fresh Juice", "Fresh fruit juice.", 150],
    ["lemonade", "Fresh Lemonade", "A refreshing lemon drink.", 120],
    ["iced-tea", "Iced Tea", "Tea served chilled.", 100],
    ["smoothie", "Fruit Smoothie", "A blended fruit drink.", 80],
    ["spiced-chai", "Spiced Chai", "Hot spiced tea.", 80],
  ] },
  { slug: "dips", name: "Dips & Chutneys", items: [
    ["tamarind-dip", "Tamarind Dip", "Tangy sweet-and-sour tamarind chutney.", 40],
    ["mint-chutney", "Fresh Mint Chutney", "A spicy green mint dip.", 40],
  ] },
] as const;

export async function seed(db: Database) {
  await db.$transaction(async tx => {
    await tx.restaurantSettings.upsert({
      where: { id: "restaurant" }, update: {},
      create: {
        id: "restaurant", address: "China Square, Unicity Mall, Thika Road, Nairobi, Kenya",
        openingHours: "Monday–Sunday: 9:00 AM–8:00 PM", phone: null, email: null,
      },
    });
    for (const [index, group] of catalog.entries()) {
      const category = await tx.category.upsert({
        where: { slug: group.slug }, update: {}, create: { slug: group.slug, name: group.name, sortOrder: index },
      });
      for (const [position, [slug, name, description, shillings]] of group.items.entries()) {
        await tx.menuItem.upsert({
          where: { slug }, update: {},
          create: { slug, name, description, priceMinor: shillings * 100, categoryId: category.id, sortOrder: position, imageUrl: null },
        });
      }
    }
  }, { timeout: 30_000 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("CHANGE_ME")) {
    console.error("Set DATABASE_URL in .env to your hosted PostgreSQL connection."); process.exitCode = 1;
  } else {
    const db = createDatabase(url);
    seed(db).then(() => console.log("Seed ready: 19 menu items, 5 categories and restaurant settings. Existing edits are preserved."))
      .catch(() => { console.error("Seeding failed. Check migrations and hosted database access."); process.exitCode = 1; })
      .finally(() => db.$disconnect());
  }
}

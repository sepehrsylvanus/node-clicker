const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const readline = require("readline");

async function scrapeKeyword(page, keyword, link) {
  try {
    // Navigate to Trendyol
    await page.goto("https://www.trendyol.com/");

    // Wait for search input to be available
    await page.waitForSelector(".N4M8bfaJ");

    // Type keyword into search input
    await page.type(".N4M8bfaJ", keyword);

    // Click search button
    await page.click(".cyrzo7gC");

    // Wait for search results page
    await page.waitForSelector(".p-card-chldrn-cntnr");

    // Scroll to product container
    await page.evaluate(() => {
      const productContainer = document.querySelector(".p-card-chldrn-cntnr");
      if (productContainer) {
        productContainer.scrollIntoView();
      }
    });

    // Get first product link and click
    const firstProductLink = await page.evaluate(() => {
      const productContainer = document.querySelector(".p-card-chldrn-cntnr");
      const firstProduct = productContainer?.querySelector("a");
      return firstProduct ? firstProduct.href : null;
    });

    if (firstProductLink) {
      await page.goto(firstProductLink);

      // Wait for add to basket button and click
      await page.waitForSelector(".add-to-basket-button-text");
      await page.click(".add-to-basket-button-text");

      // Wait a moment
      await page.waitForTimeout(2000);
    }
  } catch (error) {
    console.error(`Error processing keyword ${keyword}:`, error);
  }
}

async function main() {
  // Create readline interface to read keywords from terminal
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // First ask for the link
  console.log("Enter the link to use for all keywords:");
  const link = await new Promise((resolve) => rl.question("", resolve));

  console.log("Enter keywords (one per line). Press Enter twice to finish:");

  const keywords = [];

  // Collect keywords
  for await (const line of rl) {
    if (line.trim() === "") break;
    keywords.push(line.trim());
  }

  rl.close();

  if (keywords.length === 0) {
    console.log("No keywords provided. Exiting.");
    return;
  }

  console.log(`Processing ${keywords.length} keywords with link: ${link}`);

  // Launch browser
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    // Process each keyword one by one
    for (let i = 0; i < keywords.length; i++) {
      console.log(
        `Processing keyword ${i + 1}/${keywords.length}: ${keywords[i]}`
      );

      const page = await browser.newPage();
      await scrapeKeyword(page, keywords[i], link);
      await page.close();
    }

    // Close browser when done
    await browser.close();
    console.log("All keywords processed successfully!");
  } catch (error) {
    console.error("Main process error:", error);
    await browser.close();
  }
}

main().catch(console.error);

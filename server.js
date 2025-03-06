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

    // Close the page
    await page.close();
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

  const keywords = [];

  console.log(
    "Enter keywords and links (format: <keyword> <link>). Press Enter twice to finish:"
  );

  // Collect keywords
  for await (const line of rl) {
    if (line.trim() === "") break;

    const [keyword, link] = line.split(" ");
    keywords.push({ keyword, link });
  }

  rl.close();

  // Launch browser
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Process first keyword
    if (keywords.length > 0) {
      const { keyword, link } = keywords[0];
      await scrapeKeyword(page, keyword, link);
    }

    // Close browser
    await browser.close();
  } catch (error) {
    console.error("Main process error:", error);
  }
}

main().catch(console.error);

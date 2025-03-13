const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const readline = require("readline");
const fs = require("fs").promises;

async function scrollUntilProductFound(page, targetProductId, totalProducts) {
  console.log("[DEBUG] Starting scroll to find product by ID...");
  let lastProductCount = 0;
  let matchingProduct = null;
  const maxProductsToCheck = 500;
  let scrollPosition = 0;

  while (
    !matchingProduct &&
    !page.isClosed() &&
    (totalProducts === null || lastProductCount < totalProducts) &&
    (totalProducts === null || lastProductCount < maxProductsToCheck)
  ) {
    const products = await page
      .evaluate(() => {
        return Array.from(
          document.querySelectorAll("article.productCard-VQtVQDmG__hermiOJr6T")
        ).map((product, index) => {
          const linkElement = product.querySelector("a");
          const link = linkElement ? linkElement.getAttribute("href") : null;
          return {
            link: link,
            position: index + 1,
          };
        });
      })
      .catch(() => []);

    lastProductCount = products.length;
    matchingProduct = products.find((product) =>
      product.link?.includes(targetProductId)
    );

    if (matchingProduct) {
      console.log(
        `[INFO] Product found at position ${matchingProduct.position} after loading ${lastProductCount} products`
      );
      return matchingProduct;
    }

    if (totalProducts !== null && lastProductCount >= totalProducts) {
      console.log(
        `[INFO] Loaded all ${totalProducts} products, but target not found`
      );
      return null;
    }

    if (totalProducts !== null && lastProductCount >= maxProductsToCheck) {
      console.log(
        `[INFO] Reached limit of ${maxProductsToCheck} products, target not found`
      );
      return null;
    }

    const documentHeight = await page.evaluate(
      () => document.body.scrollHeight
    );
    if (totalProducts === null && scrollPosition >= documentHeight) {
      console.log(
        `[INFO] Reached bottom of page with ${lastProductCount} products, total unknown, target not found`
      );
      return null;
    }

    console.log(
      `[DEBUG] Loaded ${lastProductCount}/${
        totalProducts || "unknown"
      } products, scrolling...`
    );
    await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
    scrollPosition += 500;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return null;
}

async function scrapeKeyword(page, keyword, targetLink) {
  try {
    // Extract product ID from the target link (e.g., "pm-HBC00007V1CYR" from "/gaman-...-pm-HBC00007V1CYR")
    const targetProductIdMatch = targetLink.match(/pm-HB[A-Z0-9]+/);
    const targetProductId = targetProductIdMatch
      ? targetProductIdMatch[0]
      : null;
    if (!targetProductId) {
      throw new Error("Invalid product link: No product ID found");
    }
    console.log(
      `\n=== Searching "${keyword}" for product ID "${targetProductId}" ===`
    );

    // Navigate to Hepsiburada homepage
    await page.goto("https://www.hepsiburada.com/", {
      waitUntil: "networkidle2",
      timeout: 90000,
    });

    // Wait for and type into the search input
    await page.waitForSelector(".initialComponent-z0s572PM2ZR4NUXqD_iB", {
      timeout: 60000,
    });
    await page.type(".initialComponent-z0s572PM2ZR4NUXqD_iB", keyword);

    // Press Enter and wait for navigation
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }),
      page.keyboard.press("Enter"),
    ]);

    // Wait for product cards to load
    await page.waitForSelector("article.productCard-VQtVQDmG__hermiOJr6T", {
      timeout: 60000,
    });

    // Extract total products (Hepsiburada typically shows this in a span or similar element)
    const totalProducts = await page
      .evaluate(() => {
        const totalElement = document.querySelector(
          ".searchResultSummary span"
        );
        return totalElement
          ? parseInt(totalElement.textContent.match(/(\d+)/)?.[0] || "0", 10)
          : null;
      })
      .catch(() => null);
    console.log(`Total products found: ${totalProducts || "Unknown"}`);

    const matchingProduct = await scrollUntilProductFound(
      page,
      targetProductId,
      totalProducts
    );

    if (!matchingProduct) {
      console.log(`❌ Product "${targetProductId}" not found for "${keyword}"`);
      return {
        keyword,
        targetLink,
        status: "Not found",
        position: null,
        totalProducts: totalProducts,
        addedToCart: false,
      };
    }

    console.log(
      `✅ Found at position ${matchingProduct.position} out of ${
        totalProducts || "unknown"
      } products`
    );

    // Navigate to the product page
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }),
      page.goto(`https://www.hepsiburada.com${matchingProduct.link}`),
    ]);

    // Wait for and click the "Sepete ekle" button
    await page.waitForSelector('button[data-test-id="addToCart"]', {
      timeout: 30000,
    });
    await page.click('button[data-test-id="addToCart"]');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log("✅ Added to cart successfully");

    return {
      keyword,
      targetLink,
      status: "Found",
      position: matchingProduct.position,
      totalProducts: totalProducts,
      addedToCart: true,
    };
  } catch (error) {
    console.error(`❌ Error with "${keyword}":`, error.message);
    return {
      keyword,
      targetLink,
      status: "Error",
      position: null,
      totalProducts: null,
      addedToCart: false,
      error: error.message,
    };
  }
}

async function collectInputSets() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const questionAsync = (query) =>
    new Promise((resolve) => rl.question(query, resolve));

  const inputSets = [];
  let continueAdding = true;

  while (continueAdding) {
    console.log("\n--- New Product Set ---");
    const targetLink = await questionAsync("Enter product link: ");
    console.log("Enter keywords (one per line, press Enter twice to finish):");
    const keywords = [];
    while (true) {
      const line = await questionAsync("");
      if (line.trim() === "") break;
      keywords.push(line.trim());
    }

    if (keywords.length > 0) {
      inputSets.push({ targetLink, keywords });
    }

    const addMore = await questionAsync("Add another product set? (y/n): ");
    continueAdding = addMore.toLowerCase() === "y";
  }

  rl.close();
  return inputSets;
}

async function main() {
  console.log("=== Hepsiburada Product Scraper ===");

  const inputSets = await collectInputSets();
  if (!inputSets.length) {
    console.log("No inputs provided. Exiting.");
    return;
  }

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    protocolTimeout: 120000,
    timeout: 90000,
  });

  const report = {
    timestamp: new Date().toISOString(),
    results: [],
  };

  try {
    for (const set of inputSets) {
      console.log(`\nProcessing product link: "${set.targetLink}"`);
      const keywordResults = [];

      for (const keyword of set.keywords) {
        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(90000);
        await page.setDefaultTimeout(60000);
        page.on("console", (msg) => console.log("Browser:", msg.text()));

        const result = await scrapeKeyword(page, keyword, set.targetLink);
        keywordResults.push(result);
        await page.close();
      }

      report.results.push({
        productLink: set.targetLink,
        keywords: keywordResults,
      });
    }

    await browser.close();
    console.log("\n=== Scraping Completed ===");

    console.log("\nSummary:");
    report.results.forEach((set) => {
      console.log(`\nProduct Link: ${set.productLink}`);
      set.keywords.forEach((kw) => {
        console.log(
          `  "${kw.keyword}": ${
            kw.status === "Found"
              ? `Found at ${kw.position}/${kw.totalProducts}, Added: ${kw.addedToCart}`
              : `${kw.status}${kw.error ? ` - ${kw.error}` : ""}`
          }`
        );
      });
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `hepsiburada_report_${timestamp}.json`;
    await fs.writeFile(filename, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to ${filename}`);
  } catch (error) {
    console.error("Fatal error:", error);
    await browser.close();

    if (report.results.length) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `hepsiburada_report_partial_${timestamp}.json`;
      await fs.writeFile(filename, JSON.stringify(report, null, 2));
      console.log(`Partial report saved to ${filename}`);
    }
  }
}

main().catch((error) => {
  console.error("Main error:", error);
  process.exit(1);
});

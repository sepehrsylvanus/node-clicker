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
          document.querySelectorAll("div.p-card-chldrn-cntnr.card-border")
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

async function scrapeKeyword(page, keyword, targetLink, runNumber) {
  try {
    const targetProductId = targetLink.match(/p-\d+/)?.[0];
    if (!targetProductId) {
      throw new Error("Invalid product link: No product ID found");
    }
    console.log(
      `\n=== Run ${runNumber}: Searching "${keyword}" for product ID "${targetProductId}" ===`
    );

    await page.goto("https://www.trendyol.com/", {
      waitUntil: "networkidle2",
      timeout: 90000,
    });

    await page.waitForSelector('input[class*="V8wbcUhU"]', { timeout: 60000 });
    await page.type('input[class*="V8wbcUhU"]', keyword);

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }),
      page.keyboard.press("Enter"),
    ]);

    await page.waitForSelector("div.p-card-chldrn-cntnr.card-border", {
      timeout: 60000,
    });

    const totalProducts = await page
      .evaluate(() => {
        const totalElement = document.querySelector(".dscrptn.dscrptn-V2 h2");
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
        runNumber,
      };
    }

    console.log(
      `✅ Found at position ${matchingProduct.position} out of ${
        totalProducts || "unknown"
      } products`
    );

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }),
      page.goto(`https://www.trendyol.com${matchingProduct.link}`),
    ]);

    await page.waitForSelector(".add-to-basket", { timeout: 30000 });
    await page.click(".add-to-basket");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log("✅ Added to cart successfully");

    return {
      keyword,
      targetLink,
      status: "Found",
      position: matchingProduct.position,
      totalProducts: totalProducts,
      addedToCart: true,
      runNumber,
    };
  } catch (error) {
    console.error(
      `❌ Error with "${keyword}" on run ${runNumber}:`,
      error.message
    );
    return {
      keyword,
      targetLink,
      status: "Error",
      position: null,
      totalProducts: null,
      addedToCart: false,
      error: error.message,
      runNumber,
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
  console.log("=== Trendyol Product Scraper (30 Runs Across All Sets) ===");

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

  const totalRuns = 30;

  try {
    for (let run = 1; run <= totalRuns; run++) {
      console.log(`\n=== Starting Run ${run} of ${totalRuns} ===`);
      const report = {
        timestamp: new Date().toISOString(),
        runNumber: run,
        results: [],
      };

      // Process all sets in this run
      for (const set of inputSets) {
        console.log(`\nProcessing product link: "${set.targetLink}"`);
        const keywordResults = [];

        for (const keyword of set.keywords) {
          const page = await browser.newPage();
          await page.setDefaultNavigationTimeout(90000);
          await page.setDefaultTimeout(60000);
          page.on("console", (msg) => console.log("Browser:", msg.text()));

          const result = await scrapeKeyword(
            page,
            keyword,
            set.targetLink,
            run
          );
          keywordResults.push(result);
          await page.close();
        }

        report.results.push({
          productLink: set.targetLink,
          keywords: keywordResults,
        });
      }

      // Generate report for this run
      console.log(`\nSummary for Run ${run}:`);
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
      const filename = `trendyol_report_run_${run}_${timestamp}.json`;
      await fs.writeFile(filename, JSON.stringify(report, null, 2));
      console.log(`Report for Run ${run} saved to ${filename}`);
    }

    await browser.close();
    console.log("\n=== All Runs Completed ===");
  } catch (error) {
    console.error("Fatal error:", error);
    await browser.close();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `trendyol_report_partial_${timestamp}.json`;
    await fs.writeFile(
      filename,
      JSON.stringify(
        { error: error.message, partialResults: report.results },
        null,
        2
      )
    );
    console.log(`Partial report saved to ${filename}`);
  }
}

main().catch((error) => {
  console.error("Main error:", error);
  process.exit(1);
});

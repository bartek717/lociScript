const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const OpenAI = require("openai");
const readline = require("readline");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const {
  extractImagesInfo,
  getColorways,
  waitForEvent,
  addProductsToSupabase,
  addSubProductsToSupabase,
  highlight_links,
  sleep,
  image_to_base64,
  getSingleSize,
} = require("./helperFunctions.js");
require("dotenv").config();

const supabaseUrl = "https://bntnpmsprmpxshkkigtf.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

puppeteer.use(StealthPlugin());
console.log(process.env.OPENAI_API_KEY);
const openai = new OpenAI({
  apiKey: "",
});
const timeout = 8000;

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
  });

  const page = await browser.newPage();

  await page.setViewport({
    width: 1200,
    height: 1200,
    deviceScaleFactor: 1.75,
  });

  const messages = [
    {
      role: "system",
      content: `You are a website crawler. Your job will be to identify all of the products on a given page, and return the URL to them. The links on the website will be highlighted in red in the screenshot. Always read what is in the screenshot. Don't guess link names. If you are clicking on a product, put the exact name of the product and dont add anything extra. You can click directly on product names by putting the name of the product, even if it is not highlighted in red. Always click the first product that you have not yet clicked on. Also dont add the type of item you are clicking on to the click (dont add shoes, etc). DO NOT CLICK ON ANY ITEM THAT HAS EXCLUSIVITY (APP ONLY, MEMBERS ONLY, ETC)

You can go to a specific URL by answering with the following JSON format:
{"url": "url goes here"}

You can click links on the website by referencing the text inside of the link/button, by answering in the following JSON format:
{"click": "Text in link"}

Ensure that you click on all of the products in order to ensure that you know all of the sizes for each color scheme. Do not ask me if you should click on them, just click on them. Make sure that you only specify a single line of text, ex. "Nike Dunk Low Metro". 

For Nike, once you are on the products screen, click on each colorway. Do this by returning {"get_colorways": {"currentProductName": "Product Name", "currentProductPrice": "$ (Product Price)"}}, where "currentProductName" is the current product page we are on, and "currentProductPrice" is the price of the current product we are on.
Do not click on any size guides.
DO NOT REURN ANYTHING BUT THE JSON FOR THE ACTION YOU WOULD LIKE TO TAKE.
        `,
    },
  ];

  let urls = [
    "https://ca.puma.com/ca/en/men/shoes/classics",
    "https://www.nike.com/ca/w/mens-shoes-nik1zy7ok",
  ];

  let products_scraped = [];

  let screenshot_taken = false;
  for (const url of urls) {
    let useUrl = url;
    while (true) {
      if (useUrl) {
        console.log("Crawling " + useUrl);
        await page.goto(useUrl, {
          waitUntil: "domcontentloaded",
        });

        await highlight_links(page);

        await Promise.race([waitForEvent(page, "load"), sleep(timeout)]);

        await highlight_links(page);

        await page.screenshot({
          path: "screenshot.jpg",
          fullPage: true,  // This tells Puppeteer to capture the entire scrollable page
          quality: 100
        });

        screenshot_taken = true;
        useUrl = null;
      }

      if (screenshot_taken) {
        const base64_image = await image_to_base64("screenshot.jpg");
        let productText =
          products_scraped.length > 0
            ? "You have already scraped the following products: " +
              products_scraped.join(", ")
            : "No products have been scraped yet.";
        messages.push({
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: base64_image,
            },
            {
              type: "text",
              text: `Here's the screenshot of the website you are on right now. You can click on links with {"click": "Link text"}. If you are on a product page and want to traverse the colorwaves to get their sizes, return {"get_colorways": {"currentProductName": "Product Name", "currentProductPrice": "$ (Product Price)"}}. If there is no colorwaves of the product, return {"single": {"currentProductName": "Product Name", "currentProductPrice": "$ (Product Price)"}}
              . ${productText}. Continue to scrape the products you have not scraped yet. DI  DO NOT REURN ANYTHING BUT THE JSON FOR THE ACTION YOU WOULD LIKE TO TAKE.,DO NOT CLICK ON ANY ITEM THAT HAS EXCLUSIVITY (APP ONLY, MEMBERS ONLY, ETC)`
            },
          ],
        });

        screenshot_taken = false;
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        max_tokens: 1024,
        messages: messages,
      });

      const message = response.choices[0].message;
      const message_text = message.content;

      messages.push({
        role: "assistant",
        content: message_text,
      });

      console.log("GPT: " + message_text);

      if (message_text.indexOf('{"click": "') !== -1) {
        let parts = message_text.split('{"click": "');
        parts = parts[1].split('"}');
        const link_text = parts[0].replace(/[^a-zA-Z0-9 ]/g, "");
      
        console.log("Clicking on " + link_text);
      
        try {
          const elements = await page.$$("[gpt-link-text]");
          let partial;
          let exact;
      
          for (const element of elements) {
            const attributeValue = await page.evaluate(
              el => el.getAttribute("gpt-link-text"),
              element
            );
      
            if (attributeValue.includes(link_text)) {
              partial = element;
            }
      
            if (attributeValue === link_text) {
              exact = element;
            }
          }
      
          const elementToClick = exact || partial;
          if (elementToClick) {
            console.log("Found match for clicking.");
      
            // Check if the element is in the viewport
            const isVisible = await elementToClick.isIntersectingViewport();
            if (!isVisible) {
              console.log("Element is off-screen, scrolling into view...");
              await elementToClick.scrollIntoViewIfNeeded();
            }
      
            await elementToClick.click();
      
            try {
              await page.waitForNavigation({
                waitUntil: "networkidle0",
                timeout: 20000,
              });
            } catch (error) {
              console.error("Navigation failed after clicking:", error);
            }
          } else {
            throw new Error("Can't find link with text: " + link_text);
          }
        

          await Promise.race([waitForEvent(page, "load"), sleep(timeout)]);

          await highlight_links(page);

          await page.screenshot({
            path: "screenshot.jpg",
            fullPage: true,  // This tells Puppeteer to capture the entire scrollable page
            quality: 100
          });

          screenshot_taken = true;
        } catch (error) {
          console.log(error);

          messages.push({
            role: "user",
            content: "ERROR: I was unable to click that element",
          });
        }

        continue;
      } else if (message_text.indexOf('{"url": "') !== -1) {
        let parts = message_text.split('{"url": "');
        parts = parts[1].split('"}');
        useUrl = parts[0];

        continue;
      } else if (message_text.includes('{"single":')) {
        try {
          // Assuming message_text is a properly formatted JSON string
          const data = JSON.parse(message_text);
          const { currentProductName, currentProductPrice } = data.single;
          let id;
          console.log("Current Product: " + currentProductName);
          console.log("Current Product Price: " + currentProductPrice); // Assuming the price already includes the dollar sign

          if (url === "https://www.nike.com/ca/w/mens-shoes-nik1zy7ok") {
            id = await addProductsToSupabase({
              company: "nike",
              productName: currentProductName,
              price: currentProductPrice.replace("$", ""),
            });
          }else if (url === "https://ca.puma.com/ca/en/men/shoes/classics") {
            id = await addProductsToSupabase({
              company: "puma",
              productName: currentProductName,
              price: currentProductPrice.replace("$", ""),
            });
          }
          console.log("the id is")
          console.log(id)
          if (id) {
            await getSingleSize(messages, page, id);
            await page.goto(url);
            products_scraped.push(
              `${currentProductName} at ${currentProductPrice}`
            );
            console.log("Scraped Products: " + products_scraped.join(", "));
            screenshot_taken = false;
            useUrl = url;
          }
        } catch (error) {
          console.log("Error parsing product details:", error);
        }
      } else if (message_text.includes('{"get_colorways":')) {
        try {
          // Assuming message_text is a properly formatted JSON string
          const data = JSON.parse(message_text);
          const { currentProductName, currentProductPrice } =
            data.get_colorways;
          let id;
          console.log("Current Product: " + currentProductName);
          console.log("Current Product Price: " + currentProductPrice); // Assuming the price already includes the dollar sign

          if (url === "https://www.nike.com/ca/w/mens-shoes-nik1zy7ok") {
            id = await addProductsToSupabase({
              company: "nike",
              productName: currentProductName,
              price: currentProductPrice.replace("$", ""),
            });
          }else if (url === "https://ca.puma.com/ca/en/men/shoes/classics") {
            id = await addProductsToSupabase({
              company: "puma",
              productName: currentProductName,
              price: currentProductPrice.replace("$", ""),
            });
          }
          console.log("before getting colorways")
          if (id) {
            console.log("getting colorways")
            await getColorways(messages, page, id, url);
            await page.goto(url);
            products_scraped.push(
              `${currentProductName} at ${currentProductPrice}`
            );
            console.log("Scraped Products: " + products_scraped.join(", "));
            screenshot_taken = false;
            useUrl = url;
          }
        } catch (error) {
          console.log("Error parsing product details:", error);
        }
      }

      continue;
    }
  }
})();

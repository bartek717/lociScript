const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const OpenAI = require("openai");
const readline = require("readline");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = "https://bntnpmsprmpxshkkigtf.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

puppeteer.use(StealthPlugin());
const openai = new OpenAI();
const timeout = 8000;

async function image_to_base64(image_file) {
  return await new Promise((resolve, reject) => {
    fs.readFile(image_file, (err, data) => {
      if (err) {
        console.error("Error reading the file:", err);
        reject();
        return;
      }

      const base64Data = data.toString("base64");
      const dataURI = `data:image/jpeg;base64,${base64Data}`;
      resolve(dataURI);
    });
  });
}

async function extractImagesInfo(page) {
  return await page.evaluate(() => {
    const images = document.querySelectorAll("img");
    return Array.from(images).map((img) => ({
      src: img.src,
      alt: img.alt,
      width: img.width,
      height: img.height,
    }));
  });
}

async function sleep(milliseconds) {
  return await new Promise((r, _) => {
    setTimeout(() => {
      r();
    }, milliseconds);
  });
}

async function highlight_links(page) {
  await page.evaluate(() => {
    document.querySelectorAll("[gpt-link-text]").forEach((e) => {
      e.removeAttribute("gpt-link-text");
    });
  });

  const elements = await page.$$(
    "a, button, input, textarea, [role=button], [role=treeitem]"
  );

  elements.forEach(async (e) => {
    await page.evaluate((e) => {
      function isElementVisible(el) {
        if (!el) return false; // Element does not exist

        function isStyleVisible(el) {
          const style = window.getComputedStyle(el);
          return (
            style.width !== "0" &&
            style.height !== "0" &&
            style.opacity !== "0" &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        }

        function isElementInViewport(el) {
          const rect = el.getBoundingClientRect();
          return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <=
              (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <=
              (window.innerWidth || document.documentElement.clientWidth)
          );
        }

        // Check if the element is visible style-wise
        if (!isStyleVisible(el)) {
          return false;
        }

        // Traverse up the DOM and check if any ancestor element is hidden
        let parent = el;
        while (parent) {
          if (!isStyleVisible(parent)) {
            return false;
          }
          parent = parent.parentElement;
        }

        // Finally, check if the element is within the viewport
        return isElementInViewport(el);
      }

      e.style.border = "1px solid red";

      const position = e.getBoundingClientRect();

      if (position.width > 5 && position.height > 5 && isElementVisible(e)) {
        const link_text = e.textContent.replace(/[^a-zA-Z0-9 ]/g, "");
        e.setAttribute("gpt-link-text", link_text);
      }
    }, e);
  });
}

async function addProductsToSupabase(products) {
  const { data, error } = await supabase.from("products").insert(products);

  if (error) {
    console.error("Error inserting products into Supabase:");
  } else {
    console.log("Successfully added products to Supabase:");
  }
}

async function waitForEvent(page, event) {
  return page.evaluate((event) => {
    return new Promise((r, _) => {
      document.addEventListener(event, function (e) {
        r();
      });
    });
  }, event);
}

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
      content: `You are a website crawler. Your job will be to identify all of the products on a given page, and return the url to them. The links on the website will be highlighted in red in the screenshot. Always read what is in the screenshot. Don't guess link names.

You can go to a specific URL by answering with the following JSON format:
{"url": "url goes here"}

You can click links on the website by referencing the text inside of the link/button, by answering in the following JSON format:
{"click": "Text in link"}

Ensure that you click on all of the products in order to ensure that you know all of the sizes for each color scheme. Do not ask me if you should click on them, just click on them. Make sure that you only specifiy a single line of text, ex. "Nike Dunk Low Metro"
        `,
    },
  ];

  let urls = [
    "https://www.nike.com/ca/w/mens-shoes-nik1zy7ok",
    "https://www.adidas.ca/en/men-shoes",
  ];

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
          quality: 100,
        });

        screenshot_taken = true;
        useUrl = null;
      }

      if (screenshot_taken) {
        const base64_image = await image_to_base64("screenshot.jpg");

        messages.push({
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: base64_image,
            },
            {
              type: "text",
              text: 'Here\'s the screenshot of the website you are on right now. You can click on links with {"click": "Link text"}.',
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
              (el) => el.getAttribute("gpt-link-text"),
              element
            );

            if (attributeValue.includes(link_text)) {
              partial = element;
            }

            if (attributeValue === link_text) {
              exact = element;
            }
          }

          if (exact || partial) {
            console.log("Found match for clicking.");
            const elementToClick = exact || partial;
            await elementToClick.click();
      
            try {
              await page.waitForNavigation({ waitUntil: "load", timeout: 20000 });
            } catch (error) {
              console.error("Navigation failed after clicking:", error);
            }
          } else {
            throw new Error("Can't find link");
          }

          await Promise.race([waitForEvent(page, "load"), sleep(timeout)]);

          await highlight_links(page);

          await page.screenshot({
            path: "screenshot.jpg",
            quality: 100,
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
      }
    }
  }
})();

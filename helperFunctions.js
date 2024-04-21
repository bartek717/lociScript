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
console.log(process.env.OPENAI_API_KEY)
const openai = new OpenAI({
  apiKey: ''
});
const timeout = 8000;

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
  
  async function addProductsToSupabase(product) {
    console.log("Attempting to add the following product to Supabase:", product);
  
    const { data: insertData, error: insertError } = await supabase
      .from("products")
      .insert([product]);  
  
    if (insertError) {
      console.error("Error inserting product into Supabase:", insertError);
      return null;  
    }
  
    console.log("Product inserted, attempting to retrieve ID...");
  
    const { data: queryData, error: queryError } = await supabase
    .from("products")
    .select("id")
    .eq("productName", product.productName)
    .order("id", { ascending: true })  
    .limit(1);  
  
    if (queryError) {
      console.error("Error querying product ID from Supabase:", queryError);
      return null;
    }
  
    if (queryData && queryData.length > 0) {
        const firstProductId = queryData[0].id;  
        console.log("Retrieved Product ID:", firstProductId);
        return firstProductId;
      } else {
        console.log("No product ID found after insertion.");
        return null;
      }
  }
  
  async function addSubProductsToSupabase(subProducts){
    const { data, error } = await supabase.from("subProduct").insert(subProducts);
  
    if (error) {
      console.log("Error inserting products into Supabase:");
      console.log(error)
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
  
  async function getColorways(messages, page, id, url) {
    console.log(url);
    let colorways;
    if (url === "https://www.nike.com/ca/w/mens-shoes-nik1zy7ok") {
        colorways = await page.$$eval('.colorway-container input[type="radio"]', inputs =>
          inputs.map(input => input.value));
    } else if (url === "https://ca.puma.com/ca/en/men/shoes/classics") {
        colorways = await page.$$eval('#style-picker label[data-test-id="color"]', labels =>
            labels.map((label, index) => ({
                description: label.querySelector('span.sr-only').innerText,
                selectorId: `color-selector-${index}`
            }))
        );
    }

    const productId = id;
    console.log("THE PRODUCT ID IS");
    console.log(productId);
    console.log(colorways);

    for (const colorway of colorways) {
        console.log("Selecting colorway: " + colorway.description + " using selector ID: " + colorway.selectorId);
        await page.click(`input[data-test-id="${colorway.selectorId}"]`);

      await page.screenshot({
        path: "screenshot.jpg",
        quality: 100,
      });
  
      
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
            text: 'Here\'s the screenshot of the website you are on right now. Get the sizes of the current product page you are on.  Simply return the numbers, as well as the colorwave name (guess based on the image), like the following example: {{3, 4, 7, 11, 11.5, 12.5, 13}, "blue"} DO NOT REURN ANYTHING BUT THE JSON.',
          },
        ],
      });
      
      const response = await openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        max_tokens: 1024,
        messages: messages,
      });
  
      const message = response.choices[0].message;
      const message_text = message.content;
      
      const regex = /\{\{([\d.,\s]+)\},\s*"([^"]+)"\}/;
      const match = message_text.match(regex);
      
      if (match) {
        const sizes = match[1].split(',').map(size => parseFloat(size.trim()));
        const colorway = match[2];
      
        console.log("SIZES FOR THE COLORWAY " + colorway + ": " + sizes.join(", "));
        console.log(productId)
        await addSubProductsToSupabase({productId: productId, sizes: sizes, colorwave: colorway});
      
        setTimeout(() => {
          console.log("sleep");
        }, 2000);
      
        messages.pop();  
    }
  }
}

async function getSingleSize(messages, page, id){
    const productId = id;
    console.log("THE PRODUCT ID IS");
    console.log(productId);
    
  
    await page.screenshot({
      path: "screenshot.jpg",
      quality: 100,
    });

    
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
          text: 'Here\'s the screenshot of the website you are on right now. Get the sizes of the current product page you are on.  Simply return the numbers, as well as the colorwave name (guess based on the image), like the following example: {{3, 4, 7, 11, 11.5, 12.5, 13}, "blue"} DO NOT REURN ANYTHING BUT THE JSON.',
        },
      ],
    });
    
    const response = await openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      max_tokens: 1024,
      messages: messages,
    });

    const message = response.choices[0].message;
    const message_text = message.content;
    
    const regex = /\{\{([\d.,\s]+)\},\s*"([^"]+)"\}/;
    const match = message_text.match(regex);
    
    if (match) {
      const sizes = match[1].split(',').map(size => parseFloat(size.trim()));
      const colorway = match[2];
    
      console.log("SIZES FOR THE COLORWAY " + colorway + ": " + sizes.join(", "));
      console.log(productId)
      await addSubProductsToSupabase({productId: productId, sizes: sizes, colorwave: "Single Color"});
    
      setTimeout(() => {
        console.log("sleep");
      }, 2000);
    
    messages.pop();  
    }
  }



  module.exports = {extractImagesInfo, getColorways, waitForEvent, addProductsToSupabase, addSubProductsToSupabase, highlight_links, sleep, image_to_base64, getSingleSize}
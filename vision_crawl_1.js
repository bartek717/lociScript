const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const OpenAI = require('openai');
const readline = require('readline');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = 'https://bntnpmsprmpxshkkigtf.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)


puppeteer.use(StealthPlugin());
const openai = new OpenAI();
const timeout = 8000;

async function image_to_base64(image_file) {
    return await new Promise((resolve, reject) => {
        fs.readFile(image_file, (err, data) => {
            if (err) {
                console.error('Error reading the file:', err);
                reject();
                return;
            }

            const base64Data = data.toString('base64');
            const dataURI = `data:image/jpeg;base64,${base64Data}`;
            resolve(dataURI);
        });
    });
}

async function input( text ) {
    let the_prompt;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    await (async () => {
        return new Promise( resolve => {
            rl.question( text, (prompt) => {
                the_prompt = prompt;
                rl.close();
                resolve();
            } );
        } );
    })();

    return the_prompt;
}

async function sleep( milliseconds ) {
    return await new Promise((r, _) => {
        setTimeout( () => {
            r();
        }, milliseconds );
    });
}

async function highlight_links( page ) {
    await page.evaluate(() => {
        document.querySelectorAll('[gpt-link-text]').forEach(e => {
            e.removeAttribute("gpt-link-text");
        });
    });

    const elements = await page.$$(
        "a, button, input, textarea, [role=button], [role=treeitem]"
    );

    elements.forEach( async e => {
        await page.evaluate(e => {
            function isElementVisible(el) {
                if (!el) return false; // Element does not exist

                function isStyleVisible(el) {
                    const style = window.getComputedStyle(el);
                    return style.width !== '0' &&
                           style.height !== '0' &&
                           style.opacity !== '0' &&
                           style.display !== 'none' &&
                           style.visibility !== 'hidden';
                }

                function isElementInViewport(el) {
                    const rect = el.getBoundingClientRect();
                    return (
                    rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
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

            if( position.width > 5 && position.height > 5 && isElementVisible(e) ) {
                const link_text = e.textContent.replace(/[^a-zA-Z0-9 ]/g, '');
                e.setAttribute( "gpt-link-text", link_text );
            }
        }, e);
    } );
}

async function addProductsToSupabase(products) {
    const { data, error } = await supabase
        .from('products')
        .insert(products);

    if (error) {
        console.error('Error inserting products into Supabase:');
    } else {
        console.log('Successfully added products to Supabase:');
    }
}

async function waitForEvent(page, event) {
    return page.evaluate(event => {
        return new Promise((r, _) => {
            document.addEventListener(event, function(e) {
                r();
            });
        });
    }, event)
}

(async () => {
    const browser = await puppeteer.launch( {
        headless: "new",
    } );

    const page = await browser.newPage();

    await page.setViewport( {
        width: 1200,
        height: 1200,
        deviceScaleFactor: 1.75,
    } );

    const messages = [
        {
            "role": "system",
            "content": `You are a website crawler. Your task is to respond with the appropriate products that are on the page, as follows:
            storeName,productName,price

            for each of the products. Respond with this and only this.

            `,
        }
    ];



    let screenshot_taken = false;

    let urls = ['https://www.nike.com/ca/w/mens-shoes-nik1zy7ok', 'https://www.adidas.ca/en/men-shoes']
    const products = [];
    for (const url of urls) {
        if( url ) {
            console.log("Crawling " + url);
            await page.goto( url, {
                waitUntil: "domcontentloaded",
            } );

            await highlight_links( page );

            await Promise.race( [
                waitForEvent(page, 'load'),
                sleep(timeout)
            ] );

            await highlight_links( page );

            await page.screenshot( {
                path: "screenshot.jpg",
                quality: 100,
            } );

            screenshot_taken = true;
        }

        if( screenshot_taken ) {
            const base64_image = await image_to_base64("screenshot.jpg");

            messages.push({
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": base64_image,
                    },
                    {
                        "type": "text",
                        "text": "Here's the screenshot of the website you are on right now. ",
                    }
                ]
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
        console.log(message_text)
        const lines = message_text.split('\n');
        lines.forEach(line => {
            const [company, productName, price] = line.split(',');
            if(company == 'Nike' || company == 'Adidas'){
                products.push({
                    company,
                    productName,
                    price
                });
            }
        });
    }
    console.log(products);
    await addProductsToSupabase(products);
})();
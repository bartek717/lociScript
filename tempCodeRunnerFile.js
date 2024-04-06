    let urls = ['https://www.nike.com/ca/w/mens-shoes-nik1zy7ok', 'https://www.adidas.ca/en/men-shoes']
    const products = [];
    for (const url of urls) {
        if( url ) {
            console.log("Crawling " + url);
            await page.goto( url, {
                waitUntil: "domcontentloaded",
            } );

            await highlight_links( page );

            const imagesInfo = await extractImagesInfo(page);
            console.log(imagesInfo);


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
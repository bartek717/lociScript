const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const url = process.argv[2];
// const url = 'https://www.nike.com/ca/w?q=shoes&vst=shoes'
const timeout = 8000;

(async () => {
    try{
        const browser = await puppeteer.launch( {
            headless: "new",
        } );
    
        const page = await browser.newPage();
    
        await page.setViewport( {
            width: 1200,
            height: 1200,
            deviceScaleFactor: 1,
        } );
    
        // setTimeout(async () => {
        //     await page.screenshot( {
        //         path: "screenshot.jpg",
        //         fullPage: true,
        //     } );
        // }, timeout-2000);
    
        await page.goto( url, {
            waitUntil: "domcontentloaded",
            timeout: timeout,
        } );
    
        await page.screenshot( {
            path: "screenshot.jpg",
            fullPage: true,
        } );
    
        await browser.close();
    }catch(error){
        console.log(error)
    }
})();
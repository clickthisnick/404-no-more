import { launch, Page } from 'puppeteer';
import * as rp from 'request-promise-native';
import { argv } from 'yargs';

interface ILink {
    includedInHost: boolean;
    baseURI: string;
    href: string;
}

class FourOhFourNoMore {
    public browser: any;
    public badStatusLinks: string[] = [];
    public timeout = 6000;
    public startingWebsite = argv.url
    public hostname = argv.host
    public linkMap: {[s: string]: ILink} = {
        [this.startingWebsite]: {
          includedInHost: true,
          baseURI: '',
          href: this.startingWebsite,
        }
      };
    
    public unvisitedLinks: string[] = [
        this.startingWebsite
    ];
  
    constructor() {
        if (argv.host === undefined || argv.url === undefined) {
            throw new Error('Incorrect usage:\n Specify both the url and the host\n  npm run test -- --url=[url] --host=[hostname]');
        }
    }

    private delay(timeout) {
      return new Promise((resolve) => {
        setTimeout(resolve, timeout);
      });
    }

    private requestPromiseOptions(link) {
        return {
            // The url you want to send a request to
            uri: link,
    
            // Makes ALL requests (200, 400, 500) fulfil the promise (o/w 500's reject the promise)
            simple: false,
    
            // Gives us the XHR (not just the body) as the promise-resolving value
            resolveWithFullResponse: true,
    
            // Doesn't follow HTTP 3xx responses as redirects
            followRedirect: true,
    
            // Encoding to be used on setEncoding of response data. If null, the body is returned as a Buffer.
            //  |- Note: if you expect binary data, you should set encoding: null
            encoding: null,
        }
    }

    public async getNewLinks(
        page: Page,
        linkMap: {[s: string]: ILink},
        unvisitedLinks: string[],
        hostname: string
      ) {
        return page.evaluate((linkMap: {[s: string]: ILink},
          unvisitedLinks: string[],
          hostname: string
        ) => {
          const aTags = [].slice.call(document.getElementsByTagName("a"));
      
          aTags.forEach((aTag: HTMLAnchorElement) => {
            const style = window.getComputedStyle(aTag);
      
            if (
              linkMap[aTag.href] === undefined &&
              !aTag.href.startsWith('mailto:') &&
              !aTag.href.startsWith('tel:') &&
              !aTag.href.startsWith('javascript:') &&
              aTag.href.trim().length !== 0 &&
              // Check that the element is visible
              style &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0'
            ) {
              linkMap[aTag.href] = {
                includedInHost: aTag.hostname.includes(hostname),
                baseURI: aTag.baseURI || '',
                href: aTag.href,
              }
              unvisitedLinks.push(aTag.href);
            }
          })
      
          return [linkMap, unvisitedLinks];
        }, linkMap, unvisitedLinks, hostname)
      }

    public async run() {
        this.browser = await launch({headless: true}); // default is true
      
        while (this.unvisitedLinks.length !== 0) {
          const link = this.unvisitedLinks[0];
      
          // Headless puppeteer cannot navigate to pdfs
          let thisLinkIsPDF = false;
      
          try {
            const xhr = await rp(this.requestPromiseOptions(link));
      
            // Sometimes websites have a cdn link that actually points to a pdf
            // puppeteer cannot navigate to pdfs so we should omit that link from the goTo step
            thisLinkIsPDF = xhr.request.path.split('?')[0].endsWith('.pdf');
      
            if (![200, 999].includes(xhr.statusCode)) {
              const badLink = `Status Code ${xhr.statusCode}\n${link}\nFound on page: ${this.linkMap[link].baseURI}\n`;
      
              if (argv.debug) {
                console.log(badLink);
              }
              
              this.badStatusLinks.push(badLink);
            }
          } catch(e) {
            // console.log(`Request Promise: ${link}`);
            // console.log(e);
          }
      
          const page = await this.browser.newPage();
      
          if (
            this.linkMap[link].includedInHost &&
            // puppeteer headless cannot navigate to pdfs
            // https://github.com/GoogleChrome/puppeteer/issues/830
            !link.split('?')[0].endsWith('.pdf') &&
            !thisLinkIsPDF
          ) {
            // Go to the first unvisited url only if in host
            try {
              if (argv.debug) {
                  let debugLink = link;
      
                  if (link.includes('?')) {
                    debugLink = link.split('?')[0];
                  }
                  process.stdout.write(`Unvisited Links: ${this.unvisitedLinks.length} - ${debugLink} `);
              }
      
              await page.goto(link, {timeout: this.timeout});
      
              // This is a courtesy so we aren't ddosing a website
              await this.delay(1000);
      
              const paints = await page.evaluate(_ => {
                const result = {};
                performance.getEntries().map(entry => {
                  result[entry.name] = entry.startTime;
                });
                return result;
              });
      
              if (argv.debug) {
                process.stdout.write(`- First-Paint: ${Math.round(paints['first-paint'])}ms\n`);
              }
      
            } catch(e) {
              console.log(`Page goto: ${link}`);
              console.log(e);
            }
          }
      
          // Remove the url the page just went to
          this.unvisitedLinks.shift();
      
          // Get the new links
          try {
            [this.linkMap, this.unvisitedLinks] = await this.getNewLinks(page, this.linkMap, this.unvisitedLinks, this.hostname);
          } catch(e) {
            console.log('Getting New Links');
            console.log(e);
          }
      
          // Close the Page
          await page.close();
        }
      
        console.log('Done Scanning!');
        console.log('Bad Status Links:');
      
        for (const link of this.badStatusLinks) {
          console.log(link);
        }
      
        await this.browser.close();
    }
}

const test = new FourOhFourNoMore()
test.run();
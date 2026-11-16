import { GluegunToolbox } from 'gluegun'
import { TARGET, KMART, BIG_W } from '../contants'

module.exports = {
  name: 'scrape',
  alias: ['s'],
  description: 'Runs the webscraper',
  run: async (toolbox: GluegunToolbox) => {
    const { scrape, prompt, print, parameters } = toolbox

    let sitesToScrape: string[] = []

    // Allow direct command line argument (e.g. `node bin/BuyBot scrape kmart`)
    const cliArg = parameters.first ? parameters.first.toLowerCase() : null
    if (cliArg) {
      if (cliArg.includes('target')) sitesToScrape.push(TARGET)
      else if (cliArg.includes('kmart')) sitesToScrape.push(KMART)
      else if (
        cliArg.includes('bigw') ||
        cliArg.includes('big-w') ||
        cliArg.includes('big_w')
      ) {
        sitesToScrape.push(BIG_W)
      }
    }

    // If no CLI argument provided, ask interactively
    if (sitesToScrape.length === 0) {
      const response: { sitesToScrape: string[] } = await prompt.ask({
        type: 'multiselect',
        name: 'sitesToScrape',
        message:
          'Which sites do you want to scrape? (Press SPACEBAR to select, then ENTER)',
        choices: [TARGET, KMART, BIG_W]
      })
      sitesToScrape = response.sitesToScrape || []
    }

    if (sitesToScrape.length === 0) {
      print.warning('\nNo sites selected!')
      print.info(
        'Tip: Use ARROW keys to navigate, press SPACEBAR to check a site, and then press ENTER.'
      )
      print.info(
        'You can also run directly: node bin/BuyBot scrape target (or kmart, bigw)\n'
      )
      return
    }

    print.info(`\nStarting scraper for: ${sitesToScrape.join(', ')}...`)

    const scraper_funcs = []
    if (sitesToScrape.includes(TARGET)) {
      scraper_funcs.push(
        scrape(TARGET).catch(err =>
          print.error(`Target scraper error: ${err.message || err}`)
        )
      )
    }
    if (sitesToScrape.includes(KMART)) {
      scraper_funcs.push(
        scrape(KMART).catch(err =>
          print.error(`Kmart scraper error: ${err.message || err}`)
        )
      )
    }
    if (sitesToScrape.includes(BIG_W)) {
      scraper_funcs.push(
        scrape(BIG_W).catch(err =>
          print.error(`Big W scraper error: ${err.message || err}`)
        )
      )
    }

    await Promise.all(scraper_funcs)
  }
}

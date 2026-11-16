import * as fs from 'fs'
import { GluegunToolbox } from 'gluegun'
import * as schedule from 'node-schedule'
import { TARGET, KMART, BIG_W } from '../contants'
import { scrapeTarget } from '../utils/scrape-target-util'
import { scrapeKmart } from '../utils/scrape-kmart-util'
import { scrapeBigW } from '../utils/scrape-bigw-util'

module.exports = (toolbox: GluegunToolbox) => {
  toolbox.scrape = async (site: string) => {
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
    const cronJobSchedule = config.cronSchedule

    let scraperToRun = scrapeTarget

    if (site === KMART) {
      scraperToRun = scrapeKmart
    } else if (site === BIG_W) {
      scraperToRun = scrapeBigW
    } else if (site === TARGET) {
      scraperToRun = scrapeTarget
    }

    if (!cronJobSchedule) {
      await scraperToRun(config)
    } else {
      toolbox.print.info(`Scheduled BuyBot for ${site} checkout`)
      schedule.scheduleJob(cronJobSchedule, async () => {
        await scraperToRun(config)
      })
    }
  }
}

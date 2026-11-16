import * as fs from 'fs'
import { GluegunCommand } from 'gluegun'
import { input, inputSchedule } from '../utils/buybot-util'

const command: GluegunCommand = {
  name: 'buybot',
  run: async toolbox => {
    const { prompt, print } = toolbox
    print.info(`
    Welcome to the BuyBot CLI (Australia). Please enter your checkout info in the following prompts.
    All data will only be stored locally on your computer in config.json.
    `)
    const cronSchedule = await inputSchedule(prompt)
    const firstName = await input('firstName', prompt, print)
    const lastName = await input('lastName', prompt, print)
    const phoneNumber = await input('phoneNumber', prompt, print)
    const email = await input('email', prompt, print)
    const address = await input('address', prompt, print)
    const suburb = await input('suburb', prompt, print)
    const state = await input('state', prompt, print)
    const postcode = await input('postcode', prompt, print)
    const creditCardNumber = await input('creditCardNumber', prompt, print)
    const expirationMonth = await input('expirationMonth', prompt, print)
    const expirationYear = await input('expirationYear', prompt, print)
    const cvv = await input('cvv', prompt, print)
    const targetLink = await input('targetLink', prompt, print)
    const kmartLink = await input('kmartLink', prompt, print)
    const bigwLink = await input('bigwLink', prompt, print)

    print.info(`
    ...Saving config...
    `)
    const config: { [key: string]: any } = {
      firstName,
      lastName,
      phoneNumber,
      email,
      address,
      suburb,
      state,
      postcode,
      creditCardNumber,
      expirationMonth,
      expirationYear,
      cvv,
      cronSchedule,
      targetLink,
      kmartLink,
      bigwLink
    }
    fs.writeFileSync('config.json', JSON.stringify(config, null, 4))

    print.info(`
    Configuration saved to config.json! Run the scraper with:

      node bin/BuyBot scrape
      or
      node bin/BuyBot scrape kmart
      node bin/BuyBot scrape bigw
      node bin/BuyBot scrape target
    `)
  }
}

module.exports = command

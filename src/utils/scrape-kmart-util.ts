import * as notifier from 'node-notifier'
import { launchBrowser, setupPage } from './browser-util'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const scrapeKmart = async (config: { [key: string]: string }) => {
  const {
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
    kmartLink
  } = config

  if (!kmartLink) {
    throw new Error('kmartLink is not set in config.json')
  }

  const browser = await launchBrowser('./puppeteer_data_kmart')

  try {
    const page = await browser.newPage()
    await setupPage(page)
    await page.setDefaultNavigationTimeout(60000)

    console.log(`Navigating to Kmart product: ${kmartLink}`)
    await page.goto(kmartLink, { waitUntil: 'domcontentloaded' })
    await sleep(4000)

    // Wait and refresh loop until "Add to bag" / "Add to delivery" is available
    const addToBagSelector =
      'button[data-testid="product-button"], div.product-button-container button, div[class*="product-button-container"] button, button.product-button, button[data-testid="add-to-bag-button"], button[data-test="add-to-cart-button"], button[aria-label*="Add to bag"], button[aria-label*="Add to delivery"], button[aria-label*="Add to cart"]'

    console.log('Checking stock on Kmart...')
    while (true) {
      try {
        const pageTitle = await page.title()
        if (pageTitle.toLowerCase().includes('access denied')) {
          console.log('Rate limit detected. Cooling down for 3 minutes...')
          await sleep(180000)
          await page.reload({ waitUntil: 'domcontentloaded' })
          continue
        }

        await page.waitForSelector(addToBagSelector, { timeout: 8000 })
        const btn = await page.$(addToBagSelector)
        if (btn) {
          const btnInfo = await page.evaluate(el => {
            return {
              disabled: Boolean((el as HTMLButtonElement).disabled),
              text: (el.textContent || '').trim().toLowerCase()
            }
          }, btn)

          if (
            !btnInfo.disabled &&
            (btnInfo.text.includes('add to bag') ||
              btnInfo.text.includes('add to cart') ||
              btnInfo.text.includes('add to delivery'))
          ) {
            console.log(`Item in stock! Button text: "${btnInfo.text}". Clicking Add to Bag...`)
            await btn.click()
            break
          } else {
            throw new Error(`Button disabled or out of stock (text: "${btnInfo.text}")`)
          }
        }
        throw new Error('Button not found')
      } catch (err) {
        const randomDelay = Math.floor(Math.random() * 20000) + 20000
        console.log(
          `Out of stock or waiting. Refreshing in ${Math.round(
            randomDelay / 1000
          )}s...`
        )
        await sleep(randomDelay)
        await page.reload({ waitUntil: 'domcontentloaded' })
      }
    }

    await sleep(4000)

    // Navigate to Bag / Cart
    const viewBagButton = await page.$(
      'button[data-testid="view-bag"], a[data-testid="view-bag"], a[href*="/checkout/bag"], a[href*="/bag"], a[href*="/cart"], div[class*="MiniCart"] a, div[class*="Drawer"] a, div[class*="drawer"] a'
    )
    if (viewBagButton) {
      console.log('Clicking View Bag button in popup/drawer...')
      await viewBagButton.click()
      await sleep(3000)
    }

    if (!page.url().includes('/checkout')) {
      console.log('Navigating directly to Kmart checkout bag...')
      await page.goto('https://www.kmart.com.au/checkout/bag', {
        waitUntil: 'domcontentloaded'
      })
    }

    console.log('On Kmart bag & checkout page...')
    await sleep(4000)

    // Handle "To suburb or postcode" input field if present on the Bag page
    const postcodeAutoSuggestSelector =
      'input[data-testid="postcode-autosuggest-input"], input[aria-label*="suburb or postcode"]'
    const postcodeAutoSuggest = await page.$(postcodeAutoSuggestSelector)
    if (postcodeAutoSuggest && (postcode || suburb)) {
      const currentPostcodeVal = await page.evaluate(
        el => (el as HTMLInputElement).value || '',
        postcodeAutoSuggest
      )
      const targetLocation = postcode || suburb
      if (!currentPostcodeVal.includes(targetLocation)) {
        console.log(`Setting delivery postcode to ${targetLocation}...`)
        await postcodeAutoSuggest.click({ clickCount: 3 })
        await page.keyboard.press('Backspace')
        await postcodeAutoSuggest.type(targetLocation, { delay: 100 })
        await sleep(1500)

        // Select the first autosuggest option or press Enter
        const suggestion = await page.$(
          'li[role="option"], div[role="option"], ul[class*="autosuggest"] li, div[class*="suggestion"]'
        )
        if (suggestion) {
          await suggestion.click()
        } else {
          await page.keyboard.press('Enter')
        }
        await sleep(2500)
      } else {
        console.log(`Postcode already set to "${currentPostcodeVal}".`)
      }
    }

    // Click "Continue to details" button
    const continueToDetailsSelector =
      'div[data-testid="bagToCheckout"] button, button[data-testid="checkout-button"], button[data-testid*="continue"], div[class*="BagToCheckoutButton"] button'

    console.log('Waiting for "Continue to details" button...')
    await page.waitForSelector(continueToDetailsSelector, { timeout: 15000 })
    const continueBtn = await page.$(continueToDetailsSelector)
    if (continueBtn) {
      console.log('Clicking Continue to details...')
      await continueBtn.click()
      await sleep(4000)
    }

    // Step 2: Fill Details (Email, Name, Phone)
    const emailInput = await page.$(
      'input[name="email"], input[id*="email"], input[data-testid*="email"], input[type="email"]'
    )
    if (emailInput && email) {
      console.log('Entering email...')
      await emailInput.click({ clickCount: 3 })
      await emailInput.type(email)
    }

    const firstNameInput = await page.$(
      'input[name="firstName"], input[id*="firstName"], input[data-testid*="firstName"]'
    )
    if (firstNameInput && firstName) {
      console.log('Entering first name...')
      await firstNameInput.click({ clickCount: 3 })
      await firstNameInput.type(firstName)
    }

    const lastNameInput = await page.$(
      'input[name="lastName"], input[id*="lastName"], input[data-testid*="lastName"]'
    )
    if (lastNameInput && lastName) {
      console.log('Entering last name...')
      await lastNameInput.click({ clickCount: 3 })
      await lastNameInput.type(lastName)
    }

    const phoneInput = await page.$(
      'input[name="phone"], input[name="phoneNumber"], input[id*="phone"], input[data-testid*="phone"], input[type="tel"]'
    )
    if (phoneInput && phoneNumber) {
      console.log('Entering phone number...')
      await phoneInput.click({ clickCount: 3 })
      await phoneInput.type(phoneNumber)
    }

    // Advance to Step 3: Delivery if a "Continue" button is present
    const continueToDeliveryBtn = await page.$(
      'div[data-testid*="details"] button[type="submit"], button[data-testid*="continue"]'
    )
    if (continueToDeliveryBtn) {
      await continueToDeliveryBtn.click()
      await sleep(3000)
    }

    // Step 3: Fill Delivery (Address, Suburb, State, Postcode)
    const addressInput = await page.$(
      'input[name="address1"], input[name="streetAddress"], input[id*="address"], input[data-testid*="address"]'
    )
    if (addressInput && address) {
      console.log('Entering address...')
      await addressInput.click({ clickCount: 3 })
      await addressInput.type(address)
    }

    const suburbInput = await page.$(
      'input[name="suburb"], input[name="city"], input[id*="suburb"], input[data-testid*="suburb"]'
    )
    if (suburbInput && suburb) {
      console.log('Entering suburb...')
      await suburbInput.click({ clickCount: 3 })
      await suburbInput.type(suburb)
    }

    const postcodeInput = await page.$(
      'input[name="postcode"], input[name="postalCode"], input[id*="postcode"], input[data-testid*="postcode"]'
    )
    if (postcodeInput && postcode) {
      console.log('Entering postcode...')
      await postcodeInput.click({ clickCount: 3 })
      await postcodeInput.type(postcode)
    }

    const stateSelect = await page.$(
      'select[name="state"], select[id*="state"], select[data-testid*="state"]'
    )
    if (stateSelect && state) {
      console.log(`Selecting state ${state}...`)
      await page.select('select[name="state"], select[id*="state"]', state)
    }

    // Advance to Step 4: Payment if a "Continue" button is present
    const continueToPaymentBtn = await page.$(
      'div[data-testid*="delivery"] button[type="submit"], button[data-testid*="payment"]'
    )
    if (continueToPaymentBtn) {
      await continueToPaymentBtn.click()
      await sleep(3000)
    }

    // Step 4: Payment fields if visible
    const cardInput = await page.$(
      'input[name="cardNumber"], input[id*="cardNumber"], input[data-testid*="card"]'
    )
    if (cardInput && creditCardNumber) {
      console.log('Entering card number...')
      await cardInput.click({ clickCount: 3 })
      await cardInput.type(creditCardNumber)
    }

    const expiryInput = await page.$(
      'input[name="expiry"], input[name="cardExpiry"], input[id*="expiry"]'
    )
    if (expiryInput && expirationMonth && expirationYear) {
      console.log('Entering expiry...')
      await expiryInput.type(`${expirationMonth}/${expirationYear.slice(-2)}`)
    }

    const cvvInput = await page.$(
      'input[name="cvv"], input[id*="cvv"], input[data-testid*="cvv"]'
    )
    if (cvvInput && cvv) {
      console.log('Entering CVV...')
      await cvvInput.type(cvv)
    }

    notifier.notify({
      title: 'Kmart Australia',
      message: 'Ready to place order!',
      sound: true
    })

    // ── CHECKOUT DISABLED FOR TESTING ──────────────────────────────────────────
    // Uncomment the lines below when ready to auto-submit:
    // const placeOrderButton = await page.$('button[data-testid="place-order"]')
    // if (placeOrderButton) {
    //   await placeOrderButton.click()
    // }
    // ───────────────────────────────────────────────────────────────────────────
  } catch (error) {
    console.error('Kmart error:', error)
  } finally {
    // Browser kept open for user review
  }
}

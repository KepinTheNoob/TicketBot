import * as notifier from 'node-notifier'
import { launchBrowser, setupPage } from './browser-util'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const scrapeBigW = async (config: { [key: string]: string }) => {
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
    bigwLink
  } = config

  if (!bigwLink) {
    throw new Error('bigwLink is not set in config.json')
  }

  const browser = await launchBrowser('./puppeteer_data_bigw')

  try {
    const page = await browser.newPage()
    await setupPage(page)
    await page.setDefaultNavigationTimeout(60000)

    console.log(`Navigating to Big W product: ${bigwLink}`)
    await page.goto(bigwLink, { waitUntil: 'domcontentloaded' })
    await sleep(4000)

    // Wait and refresh loop until "Add to cart" is available
    const addToCartSelector =
      'button[data-optly-add-to-cart-button="true"], button[data-di-id="pdp--add-to-cart"], div[class*="ProductActionButtons"] button, button[data-test="add-to-cart"], button[aria-label*="Add to cart"], button[aria-label*="Add to basket"], button.add-to-cart-button'

    console.log('Checking stock on Big W...')
    while (true) {
      try {
        const pageTitle = await page.title()
        if (pageTitle.toLowerCase().includes('access denied')) {
          console.log(
            'Akamai rate limit detected (Access Denied). Cooling down for 3 minutes before retrying...'
          )
          notifier.notify({
            title: 'Big W',
            message: 'Rate limit detected. Cooling down for 3 minutes...',
            sound: false
          })
          await sleep(180000)
          await page.reload({ waitUntil: 'domcontentloaded' })
          continue
        }

        await page.waitForSelector(addToCartSelector, { timeout: 8000 })
        const btn = await page.$(addToCartSelector)
        if (btn) {
          const isDisabled = await page.evaluate(el => el.disabled, btn)
          if (!isDisabled) {
            console.log('Item in stock! Clicking Add to Cart...')
            await btn.click()
            break
          }
        }
        throw new Error('Button disabled')
      } catch (err) {
        // Randomize refresh delay between 20s and 40s to prevent Akamai rate-limiting
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

    await sleep(2500)

    // Handle Big W's "Enter your postcode for delivery and availability" side drawer if it appears
    const suburbSearchSelector =
      'input[aria-label*="Suburb search"], input.SuburbInputPrefix__input, input[id*="react-select-"][id$="-input"]'
    const postcodeInputElement = await page.$(suburbSearchSelector)

    if (postcodeInputElement) {
      console.log('Delivery postcode side panel detected! Entering location...')
      const locationValue = postcode || suburb || '2000'
      await postcodeInputElement.click()
      await postcodeInputElement.type(locationValue, { delay: 100 })
      await sleep(1500)

      // Select first matching dropdown item if available, or press Enter
      const dropdownOption = await page.$(
        'div[class*="-option"], div[id*="react-select-"][id*="-option-0"]'
      )
      if (dropdownOption) {
        await dropdownOption.click()
      } else {
        await page.keyboard.press('Enter')
      }
      await sleep(1500)

      // Click the "Save" button in the ModalDrawerCTAContainer
      const saveDrawerButton = await page.$(
        'div[class*="ModalDrawerCTAContainer"] button, div[class*="ModalDrawer"] button'
      )
      if (saveDrawerButton) {
        console.log('Clicking Save on postcode drawer...')
        await saveDrawerButton.click()
        await sleep(3000)
      }

      // If still on the product page, re-trigger "Add to cart" now that location is saved
      const reAddButton = await page.$(addToCartSelector)
      if (reAddButton) {
        const canClick = await page.evaluate(el => !el.disabled, reAddButton)
        if (canClick) {
          console.log('Re-clicking Add to cart after saving location...')
          await reAddButton.click()
          await sleep(3000)
        }
      }
    }

    await sleep(3000)

    // Navigate to Cart
    const viewCartButton = await page.$(
      'a[data-test="view-cart"], a[href*="/cart"], button[data-test="view-cart"]'
    )
    if (viewCartButton) {
      await viewCartButton.click()
    } else {
      await page.goto('https://www.bigw.com.au/cart', {
        waitUntil: 'domcontentloaded'
      })
    }

    console.log('On Big W cart page...')
    await sleep(4000)

    // Select delivery option radio button if not selected yet (e.g. Same Day Delivery / Standard Delivery)
    const deliveryRadioSelector =
      'li[role="radio"]:not(.selected), li[class*="RadioListWrapper"]:not([class*="Selected"]), div[class*="DeliveryOptionLabel"], span[class*="RadioListOption"], li[role="radio"]'
    const deliveryRadio = await page.$(deliveryRadioSelector)
    if (deliveryRadio) {
      console.log('Selecting delivery method radio button...')
      await deliveryRadio.click()
      await sleep(3000)
    }

    // Proceed to Checkout using exact data-testid from cart summary
    const checkoutButtonSelector =
      'button[data-testid="cart-submit-button"], button[data-di-id="cart--sign-in-to-checkout"], div[class*="CartSummaryActions"] button, button[data-test="checkout-button"]'

    console.log('Waiting for Proceed to checkout button...')
    await page.waitForSelector(checkoutButtonSelector, { timeout: 15000 })
    const checkoutButton = await page.$(checkoutButtonSelector)
    if (checkoutButton) {
      console.log('Clicking Proceed to checkout...')
      await checkoutButton.click()
    }

    await sleep(4000)

    // If Big W prompts with "Checkout as guest", click it
    const guestButtonSelector =
      'button[data-testid*="guest"], a[data-testid*="guest"], button[data-di-id*="guest"], a[href*="guest"]'
    const guestButton = await page.$(guestButtonSelector)
    if (guestButton) {
      console.log('Clicking Checkout as guest...')
      await guestButton.click()
    }

    await sleep(5000)

    // Fill delivery details if inputs exist (Guest Checkout)
    const emailInput = await page.$('input[name="email"], input[id="email"]')
    if (emailInput && email) {
      await emailInput.type(email)
    }

    const firstNameInput = await page.$(
      'input[name="firstName"], input[id="firstName"]'
    )
    if (firstNameInput && firstName) {
      await firstNameInput.type(firstName)
    }

    const lastNameInput = await page.$(
      'input[name="lastName"], input[id="lastName"]'
    )
    if (lastNameInput && lastName) {
      await lastNameInput.type(lastName)
    }

    const phoneInput = await page.$(
      'input[name="phone"], input[name="phoneNumber"], input[id="phone"]'
    )
    if (phoneInput && phoneNumber) {
      await phoneInput.type(phoneNumber)
    }

    const addressInput = await page.$(
      'input[name="address1"], input[name="streetAddress"], input[id="address"]'
    )
    if (addressInput && address) {
      await addressInput.type(address)
    }

    const suburbInput = await page.$(
      'input[name="suburb"], input[name="city"], input[id="suburb"]'
    )
    if (suburbInput && suburb) {
      await suburbInput.type(suburb)
    }

    const postcodeInput = await page.$(
      'input[name="postcode"], input[name="postalCode"], input[id="postcode"]'
    )
    if (postcodeInput && postcode) {
      await postcodeInput.type(postcode)
    }

    const stateSelect = await page.$(
      'select[name="state"], select[id="state"]'
    )
    if (stateSelect && state) {
      await page.select('select[name="state"], select[id="state"]', state)
    }

    await sleep(4000)

    // Payment fields if visible
    const cardInput = await page.$(
      'input[name="cardNumber"], input[id="cardNumber"]'
    )
    if (cardInput && creditCardNumber) {
      await cardInput.type(creditCardNumber)
    }

    const expiryInput = await page.$(
      'input[name="expiry"], input[name="cardExpiry"], input[id="expiry"]'
    )
    if (expiryInput && expirationMonth && expirationYear) {
      await expiryInput.type(`${expirationMonth}/${expirationYear.slice(-2)}`)
    }

    const cvvInput = await page.$('input[name="cvv"], input[id="cvv"]')
    if (cvvInput && cvv) {
      await cvvInput.type(cvv)
    }

    notifier.notify({
      title: 'Big W',
      message: 'Ready to place order!',
      sound: true
    })

    // ── CHECKOUT DISABLED FOR TESTING ──────────────────────────────────────────
    // Uncomment the lines below when ready to auto-submit:
    // const placeOrderButton = await page.$('button[data-test="place-order"]')
    // if (placeOrderButton) {
    //   await placeOrderButton.click()
    // }
    // ───────────────────────────────────────────────────────────────────────────
  } catch (error) {
    console.error('Big W error:', error)
  } finally {
    // Browser kept open for user review
  }
}

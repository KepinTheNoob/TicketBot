import * as notifier from 'node-notifier'
import { launchBrowser } from './browser-util'

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

  const { page } = await launchBrowser('./playwright_data_bigw')

  try {
    page.setDefaultTimeout(60000)

    console.log(`Navigating to Big W product: ${bigwLink}`)
    await page.goto(bigwLink, { waitUntil: 'domcontentloaded' })
    await sleep(4000)

    // Wait and refresh loop until "Add to cart" is available
    const addToCartLocator = page
      .locator(
        'button[data-optly-add-to-cart-button="true"], button[data-di-id="pdp--add-to-cart"], div[class*="ProductActionButtons"] button, button[data-test="add-to-cart"], button:has-text("Add to cart")'
      )
      .first()

    console.log('Checking stock on Big W...')
    while (true) {
      try {
        const pageTitle = await page.title()
        if (pageTitle.toLowerCase().includes('access denied')) {
          console.log(
            'Akamai rate limit detected (Access Denied). Cooling down for 3 minutes...'
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

        await addToCartLocator.waitFor({ state: 'visible', timeout: 8000 })
        const isDisabled = await addToCartLocator.isDisabled()
        if (!isDisabled) {
          console.log('Item in stock! Clicking Add to Cart...')
          await addToCartLocator.click()
          break
        }
        throw new Error('Button disabled')
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

    await sleep(2500)

    // Handle Big W's "Enter your postcode for delivery and availability" side drawer if it appears
    const suburbInputLocator = page
      .locator(
        'input[aria-label*="Suburb search"], input.SuburbInputPrefix__input, input[id*="react-select-"][id$="-input"]'
      )
      .first()

    if (await suburbInputLocator.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log('Delivery postcode side panel detected! Entering location...')
      const locationValue = postcode || suburb || '2000'
      await suburbInputLocator.click()
      await suburbInputLocator.fill(locationValue)
      await sleep(1500)

      const dropdownOption = page
        .locator('div[class*="-option"], div[id*="react-select-"][id*="-option-0"]')
        .first()
      if (await dropdownOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await dropdownOption.click()
      } else {
        await page.keyboard.press('Enter')
      }
      await sleep(1500)

      const saveDrawerButton = page
        .locator(
          'div[class*="ModalDrawerCTAContainer"] button, div[class*="ModalDrawer"] button, button:has-text("Save")'
        )
        .first()
      if (await saveDrawerButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Clicking Save on postcode drawer...')
        await saveDrawerButton.click()
        await sleep(3000)
      }

      // If still on the product page, re-trigger "Add to cart"
      if (await addToCartLocator.isVisible({ timeout: 2000 }).catch(() => false)) {
        if (!(await addToCartLocator.isDisabled())) {
          console.log('Re-clicking Add to cart after saving location...')
          await addToCartLocator.click()
          await sleep(3000)
        }
      }
    }

    await sleep(3000)

    // Navigate to Cart
    const viewCartButton = page
      .locator('a[data-test="view-cart"], a[href*="/cart"], button[data-test="view-cart"]')
      .first()
    if (await viewCartButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await viewCartButton.click()
    } else {
      await page.goto('https://www.bigw.com.au/cart', {
        waitUntil: 'domcontentloaded'
      })
    }

    console.log('On Big W cart page...')
    await sleep(4000)

    // Select delivery option radio button if not selected yet
    const deliveryRadio = page
      .locator(
        'li[role="radio"]:not(.selected), li[class*="RadioListWrapper"]:not([class*="Selected"]), div[class*="DeliveryOptionLabel"], li[role="radio"]'
      )
      .first()
    if (await deliveryRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Selecting delivery method radio button...')
      await deliveryRadio.click().catch(() => {})
      await sleep(3000)
    }

    // Proceed to Checkout
    const checkoutButton = page
      .locator(
        'button[data-testid="cart-submit-button"], button[data-di-id="cart--sign-in-to-checkout"], div[class*="CartSummaryActions"] button, button:has-text("Proceed to checkout")'
      )
      .first()

    console.log('Waiting for Proceed to checkout button...')
    await checkoutButton.waitFor({ state: 'visible', timeout: 15000 })
    console.log('Clicking Proceed to checkout...')
    await checkoutButton.click({ timeout: 15000 })
    await sleep(4000)

    // If Big W prompts with "Checkout as guest", click it
    const guestButton = page
      .locator(
        'button[data-testid*="guest"], a[data-testid*="guest"], button:has-text("Checkout as guest")'
      )
      .first()
    if (await guestButton.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log('Clicking Checkout as guest...')
      await guestButton.click()
    }

    await sleep(5000)

    // Fill delivery details if inputs exist (Guest Checkout)
    const emailInput = page.locator('input[name="email"], input[id="email"]').first()
    if (email && (await emailInput.isVisible({ timeout: 4000 }).catch(() => false))) {
      await emailInput.fill(email)
    }

    const firstNameInput = page.locator('input[name="firstName"], input[id="firstName"]').first()
    if (firstName && (await firstNameInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      await firstNameInput.fill(firstName)
    }

    const lastNameInput = page.locator('input[name="lastName"], input[id="lastName"]').first()
    if (lastName && (await lastNameInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      await lastNameInput.fill(lastName)
    }

    const phoneInput = page.locator('input[name="phone"], input[name="phoneNumber"], input[id="phone"]').first()
    if (phoneNumber && (await phoneInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      await phoneInput.fill(phoneNumber)
    }

    const addressInput = page.locator('input[name="address1"], input[name="streetAddress"], input[id="address"]').first()
    if (address && (await addressInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      await addressInput.fill(address)
    }

    const suburbInput = page.locator('input[name="suburb"], input[name="city"], input[id="suburb"]').first()
    if (suburb && (await suburbInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      await suburbInput.fill(suburb)
    }

    const postcodeInput = page.locator('input[name="postcode"], input[name="postalCode"], input[id="postcode"]').first()
    if (postcode && (await postcodeInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      await postcodeInput.fill(postcode)
    }

    const stateSelect = page.locator('select[name="state"], select[id="state"]').first()
    if (state && (await stateSelect.isVisible({ timeout: 2000 }).catch(() => false))) {
      await stateSelect.selectOption(state).catch(() => {})
    }

    await sleep(4000)

    // Payment fields if visible
    const cardInput = page.locator('input[name="cardNumber"], input[id="cardNumber"]').first()
    if (creditCardNumber && (await cardInput.isVisible({ timeout: 4000 }).catch(() => false))) {
      await cardInput.fill(creditCardNumber)
    }

    const expiryInput = page.locator('input[name="expiry"], input[name="cardExpiry"], input[id="expiry"]').first()
    if (expirationMonth && expirationYear && (await expiryInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      await expiryInput.fill(`${expirationMonth}/${expirationYear.slice(-2)}`)
    }

    const cvvInput = page.locator('input[name="cvv"], input[id="cvv"]').first()
    if (cvv && (await cvvInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      await cvvInput.fill(cvv)
    }

    notifier.notify({
      title: 'Big W',
      message: 'Ready to place order!',
      sound: true
    })

    // ── CHECKOUT DISABLED FOR TESTING ──────────────────────────────────────────
    // Uncomment the lines below when ready to auto-submit:
    // const placeOrderButton = page.locator('button[data-test="place-order"]').first()
    // if (await placeOrderButton.isVisible()) {
    //   await placeOrderButton.click()
    // }
    // ───────────────────────────────────────────────────────────────────────────
  } catch (error) {
    console.error('Big W error:', error)
  } finally {
    // Browser session kept open for user review
  }
}

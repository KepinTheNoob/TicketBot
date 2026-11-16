import * as notifier from 'node-notifier'
import { launchBrowser } from './browser-util'
import { launchBrowser } from './browser-util'

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

  const { page } = await launchBrowser('./playwright_data_kmart')
  const { page } = await launchBrowser('./playwright_data_kmart')

  try {
    page.setDefaultTimeout(60000)
    page.setDefaultTimeout(60000)

    console.log(`Navigating to Kmart product: ${kmartLink}`)
    await page.goto(kmartLink, { waitUntil: 'domcontentloaded' })
    await sleep(4000)

    // Wait and refresh loop until "Add to bag" is available
    const addToBagLocator = page
      .locator(
        'button[data-testid="product-button"], div.product-button-container button, button.product-button, button:has-text("Add to bag"), button:has-text("Add to delivery")'
      )
      .first()
    // Wait and refresh loop until "Add to bag" is available
    const addToBagLocator = page
      .locator(
        'button[data-testid="product-button"], div.product-button-container button, button.product-button, button:has-text("Add to bag"), button:has-text("Add to delivery")'
      )
      .first()

    console.log('Checking stock on Kmart...')
    while (true) {
      try {
        const pageTitle = await page.title()
        if (pageTitle.toLowerCase().includes('access denied')) {
          console.log('Akamai rate limit detected (Access Denied). Cooling down for 3 minutes...')
          notifier.notify({
            title: 'Kmart',
            message: 'Rate limit detected. Cooling down for 3 minutes...',
            sound: false
          })
          console.log('Akamai rate limit detected (Access Denied). Cooling down for 3 minutes...')
          notifier.notify({
            title: 'Kmart',
            message: 'Rate limit detected. Cooling down for 3 minutes...',
            sound: false
          })
          await sleep(180000)
          await page.reload({ waitUntil: 'domcontentloaded' })
          continue
        }

        await addToBagLocator.waitFor({ state: 'visible', timeout: 8000 })
        const btnText = (await addToBagLocator.textContent() || '').trim().toLowerCase()
        const isDisabled = await addToBagLocator.isDisabled()
        await addToBagLocator.waitFor({ state: 'visible', timeout: 8000 })
        const btnText = (await addToBagLocator.textContent() || '').trim().toLowerCase()
        const isDisabled = await addToBagLocator.isDisabled()

        if (
          !isDisabled &&
          (btnText.includes('add to bag') ||
            btnText.includes('add to cart') ||
            btnText.includes('add to delivery'))
        ) {
          console.log(`Item in stock! Button text: "${btnText}". Clicking Add to Bag...`)
          await addToBagLocator.click()
          break
        } else {
          throw new Error(`Button disabled or out of stock (text: "${btnText}")`)
        if (
          !isDisabled &&
          (btnText.includes('add to bag') ||
            btnText.includes('add to cart') ||
            btnText.includes('add to delivery'))
        ) {
          console.log(`Item in stock! Button text: "${btnText}". Clicking Add to Bag...`)
          await addToBagLocator.click()
          break
        } else {
          throw new Error(`Button disabled or out of stock (text: "${btnText}")`)
        }
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

    // Navigate to Bag / Checkout
    const viewBagBtn = page
      .locator(
        'button[data-testid="view-bag"], a[data-testid="view-bag"], a[href*="/checkout/bag"], a[href*="/bag"], div[class*="MiniCart"] a, div[class*="Drawer"] a'
      )
      .first()

    if (await viewBagBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Navigate to Bag / Checkout
    const viewBagBtn = page
      .locator(
        'button[data-testid="view-bag"], a[data-testid="view-bag"], a[href*="/checkout/bag"], a[href*="/bag"], div[class*="MiniCart"] a, div[class*="Drawer"] a'
      )
      .first()

    if (await viewBagBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Clicking View Bag button in popup/drawer...')
      await viewBagBtn.click()
      await viewBagBtn.click()
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
    const postcodeInput = page
      .locator('input[data-testid="postcode-autosuggest-input"], input[aria-label*="suburb or postcode"]')
      .first()

    if ((postcode || suburb) && (await postcodeInput.isVisible({ timeout: 4000 }).catch(() => false))) {
      const currentVal = await postcodeInput.inputValue()
      const targetLocation = postcode || suburb
      if (!currentVal.includes(targetLocation)) {
        console.log(`Setting delivery postcode to ${targetLocation}...`)
        await postcodeInput.click()
        await postcodeInput.fill(targetLocation)
        await sleep(1500)

        const option = page
          .locator('li[role="option"], div[role="option"], ul[class*="autosuggest"] li, div[class*="suggestion"]')
          .first()
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
          await option.click()
        } else {
          await page.keyboard.press('Enter')
        }
        await sleep(2500)
      } else {
        console.log(`Postcode already set to "${currentVal}".`)
      }
    }

    // Click "Continue to details" button
    const continueBtn = page
      .locator(
        'div[data-testid="bagToCheckout"] button, button[data-testid="checkout-button"], button:has-text("Continue to details")'
      )
      .first()

    console.log('Waiting for "Continue to details" button...')
    await continueBtn.waitFor({ state: 'visible', timeout: 15000 })
    console.log('Clicking Continue to details...')
    await continueBtn.click({ timeout: 15000 })
    await sleep(4000)

    // Step 2: Fill Details (Email, Name, Phone)
    const emailField = page
      .locator('input[name="email"], input[id*="email"], input[data-testid*="email"], input[type="email"]')
      .first()
    if (email && (await emailField.isVisible({ timeout: 4000 }).catch(() => false))) {
      console.log('Entering email...')
      await emailField.fill(email)
      await emailField.fill(email)
    }

    const firstNameField = page
      .locator('input[name="firstName"], input[id*="firstName"], input[data-testid*="firstName"]')
      .first()
    if (firstName && (await firstNameField.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('Entering first name...')
      await firstNameField.fill(firstName)
      await firstNameField.fill(firstName)
    }

    const lastNameField = page
      .locator('input[name="lastName"], input[id*="lastName"], input[data-testid*="lastName"]')
      .first()
    if (lastName && (await lastNameField.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('Entering last name...')
      await lastNameField.fill(lastName)
      await lastNameField.fill(lastName)
    }

    const phoneField = page
      .locator('input[name="phone"], input[name="phoneNumber"], input[id*="phone"], input[type="tel"]')
      .first()
    if (phoneNumber && (await phoneField.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('Entering phone number...')
      await phoneField.fill(phoneNumber)
      await phoneField.fill(phoneNumber)
    }

    // Advance to Step 3: Delivery if a "Continue" button is present
    const continueToDeliveryBtn = page
      .locator(
        'div[data-testid*="details"] button[type="submit"], button:has-text("Continue to delivery"), button[data-testid*="continue"]'
      )
      .first()
    if (await continueToDeliveryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Advancing to Delivery step...')
      await continueToDeliveryBtn.click()
      await sleep(4000)
    }

    // Step 3: Fill Delivery (Address, Suburb, State, Postcode)
    const addressField = page
      .locator('input[name="address1"], input[name="streetAddress"], input[id*="address"]')
      .first()
    if (address && (await addressField.isVisible({ timeout: 4000 }).catch(() => false))) {
      console.log('Entering address...')
      await addressField.fill(address)
    }

    const suburbField = page
      .locator('input[name="suburb"], input[name="city"], input[id*="suburb"]')
      .first()
    if (suburb && (await suburbField.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('Entering suburb...')
      await suburbField.fill(suburb)
    }

    const postcodeField = page
      .locator('input[name="postcode"], input[name="postalCode"], input[id*="postcode"]')
      .first()
    if (postcode && (await postcodeField.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('Entering postcode...')
      await postcodeField.fill(postcode)
    }

    const stateSelect = page.locator('select[name="state"], select[id*="state"]').first()
    if (state && (await stateSelect.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log(`Selecting state ${state}...`)
      await stateSelect.selectOption(state).catch(() => {})
    }

    // Advance to Step 4: Payment if a "Continue" button is present
    const continueToPaymentBtn = page
      .locator(
        'div[data-testid*="delivery"] button[type="submit"], button:has-text("Continue to payment"), button[data-testid*="payment"]'
      )
      .first()
    if (await continueToPaymentBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Advancing to Payment step...')
      await continueToPaymentBtn.click()
      await sleep(5000)
    }

    // Step 4: Payment fields if visible
    const cardField = page
      .locator('input[name="cardNumber"], input[id*="cardNumber"], input[data-testid*="card"]')
      .first()
    if (creditCardNumber && (await cardField.isVisible({ timeout: 4000 }).catch(() => false))) {
      console.log('Entering card number...')
      await cardField.fill(creditCardNumber)
    }

    const expiryField = page
      .locator('input[name="expiry"], input[name="cardExpiry"], input[id*="expiry"]')
      .first()
    if (expirationMonth && expirationYear && (await expiryField.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('Entering expiry...')
      await expiryField.fill(`${expirationMonth}/${expirationYear.slice(-2)}`)
      await expiryField.fill(`${expirationMonth}/${expirationYear.slice(-2)}`)
    }

    const cvvField = page.locator('input[name="cvv"], input[id*="cvv"], input[data-testid*="cvv"]').first()
    if (cvv && (await cvvField.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('Entering CVV...')
      await cvvField.fill(cvv)
    }

    notifier.notify({
      title: 'Kmart Australia',
      message: 'Ready to place order!',
      sound: true
    })

    // ── CHECKOUT DISABLED FOR TESTING ──────────────────────────────────────────
    // Uncomment the lines below when ready to auto-submit:
    // const placeOrderButton = page.locator('button[data-testid="place-order"]').first()
    // if (await placeOrderButton.isVisible()) {
    // const placeOrderButton = page.locator('button[data-testid="place-order"]').first()
    // if (await placeOrderButton.isVisible()) {
    //   await placeOrderButton.click()
    // }
    // ───────────────────────────────────────────────────────────────────────────
  } catch (error) {
    console.error('Kmart error:', error)
  } finally {
    // Browser session kept open for user review
    // Browser session kept open for user review
  }
}

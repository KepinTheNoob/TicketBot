import * as notifier from 'node-notifier'
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

  try {
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
          await sleep(180000)
          await page.reload({ waitUntil: 'domcontentloaded' })
          continue
        }

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
      console.log('Clicking View Bag button in popup/drawer...')
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

    // Step 1 (Bag): Click "Continue to details" button
    // Note: Do NOT manually modify the pre-quoted delivery postcode on the Bag page,
    // as an uncommitted postcode query corrupts Kmart's checkout state and causes a redirect to home.
    const continueBtn = page
      .locator(
        'div[data-testid="bagToCheckout"] button, button[data-testid="checkout-button"], button:has-text("Continue to details")'
      )
      .first()

    console.log('Waiting for "Continue to details" button...')
    await continueBtn.waitFor({ state: 'visible', timeout: 15000 })
    console.log('Clicking Continue to details...')
    await continueBtn.click({ timeout: 15000 })
    await sleep(5000)

    // Step 2 (Details): Fill Email, First Name, Last Name, Phone
    console.log('On Kmart Details step, filling personal info...')
    const emailField = page
      .locator('input[data-testid="email"], input[name="email"], input[id="email"]')
      .first()
    if (email && (await emailField.isVisible({ timeout: 6000 }).catch(() => false))) {
      console.log('Entering email...')
      await emailField.fill(email)
    }

    const firstNameField = page
      .locator('input[data-testid="firstName"], input[name="firstName"], input[id="firstName"]')
      .first()
    if (firstName && (await firstNameField.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('Entering first name...')
      await firstNameField.fill(firstName)
    }

    const lastNameField = page
      .locator('input[data-testid="lastName"], input[name="lastName"], input[id="lastName"]')
      .first()
    if (lastName && (await lastNameField.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('Entering last name...')
      await lastNameField.fill(lastName)
    }

    const phoneField = page
      .locator('input[data-testid="phone"], input[name="phone"], input[id="phone"]')
      .first()
    if (phoneNumber && (await phoneField.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('Entering phone number...')
      await phoneField.fill(phoneNumber)
    }

    // Advance to Step 3: Delivery
    const continueToDeliveryBtn = page
      .locator('button[data-testid="continueToDeliveryButton"], button:has-text("Continue to delivery")')
      .first()
    if (await continueToDeliveryBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log('Clicking Continue to delivery...')
      await continueToDeliveryBtn.click()
      await sleep(4000)
    }

    // Step 3 (Delivery): Enter shipping address
    console.log('On Kmart Delivery step, entering address...')
    const addressInput = page
      .locator('input[data-testid="addressInfo"], input[id="addressInfo"]')
      .first()
    if (await addressInput.isVisible({ timeout: 6000 }).catch(() => false)) {
      const fullAddress = address ? `${address} ${suburb || ''} ${state || ''} ${postcode || ''}`.trim() : '1 George Street Sydney'
      console.log(`Typing address: ${fullAddress}...`)
      await addressInput.click()
      await addressInput.fill(fullAddress)
      await sleep(2000)

      // Select first suggestion from Google Places / Address dropdown
      const suggestion = page
        .locator('div.pac-item, li[role="option"], div[role="option"], div[class*="pac-container"]')
        .first()
      if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await suggestion.click()
      } else {
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
      }
      await sleep(2000)
    }

    // Advance to Step 4: Payment
    const continueToPaymentBtn = page
      .locator('button[data-testid="continueToPaymentButton"], button:has-text("Continue to payment")')
      .first()
    if (await continueToPaymentBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log('Clicking Continue to payment...')
      await continueToPaymentBtn.click()
      await sleep(5000)
    }

    // Step 4 (Payment): Fill Card details inside Paydock iframe or native fields
    console.log('On Kmart Payment step...')
    const paydockFrame = page.frameLocator('iframe[src*="widget.paydock.com"]').first()
    const cardInput = paydockFrame
      .locator('input[name="card_number"], input[id*="card_number"], input[data-testid*="card"]')
      .first()
    if (creditCardNumber && (await cardInput.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.log('Entering credit card number into secure frame...')
      await cardInput.fill(creditCardNumber)
    }

    const expiryField = page
      .locator('input[name="expiry"], input[name="cardExpiry"], input[id*="expiry"]')
      .first()
    if (expirationMonth && expirationYear && (await expiryField.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('Entering expiry...')
      await expiryField.fill(`${expirationMonth}/${expirationYear.slice(-2)}`)
    }

    const cvvInput = paydockFrame
      .locator('input[name="card_ccv"], input[id*="card_ccv"], input[name="cvv"]')
      .first()
    if (cvv && (await cvvInput.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('Entering CVV...')
      await cvvInput.fill(cvv)
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
    //   await placeOrderButton.click()
    // }
    // ───────────────────────────────────────────────────────────────────────────
  } catch (error) {
    console.error('Kmart error:', error)
  } finally {
    // Browser session kept open for user review
  }
}

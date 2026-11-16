import * as notifier from 'node-notifier'
import { launchBrowser } from './browser-util'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const scrapeTarget = async (config: { [key: string]: string }) => {
  const {
    phoneNumber,
    firstName,
    lastName,
    state,
    city,
    suburb,
    zipCode,
    postcode,
    address,
    creditCardNumber,
    expirationMonth,
    expirationYear,
    cvv,
    targetEmail,
    targetPassword,
    targetLink
  } = config

  if (!targetLink) {
    throw new Error('targetLink setting not set in config.json')
  }

  const { page } = await launchBrowser('./playwright_data_target')

  try {
    page.setDefaultTimeout(60000)

    const isTargetAU = targetLink.includes('target.com.au')

    // Only attempt Target.com sign in if navigating to Target US and credentials exist
    if (!isTargetAU && targetEmail && targetPassword) {
      try {
        await page.goto('https://www.target.com')
        const accountDropdown = page
          .locator('#account, button[data-test="@web/AccountLink"], a[id="account"]')
          .first()
        if (await accountDropdown.isVisible({ timeout: 8000 }).catch(() => false)) {
          await accountDropdown.click()
          await sleep(2000)
        }

        const signInButton = page
          .locator('#accountNav-signIn, a[data-test="accountNav-signIn"]')
          .first()
        if (await signInButton.isVisible({ timeout: 4000 }).catch(() => false)) {
          await signInButton.click()
          await sleep(3000)
        }

        const usernameInput = page.locator('#username').first()
        if (await usernameInput.isVisible({ timeout: 4000 }).catch(() => false)) {
          await usernameInput.fill(targetEmail)
          await page.locator('#password').first().fill(targetPassword)
          await page.keyboard.press('Enter')
          await sleep(5000)
        }
      } catch (loginError: any) {
        console.log('Target login notice:', loginError?.message || loginError)
      }
    }

    console.log(`Navigating to Target product: ${targetLink}`)
    await page.goto(targetLink, { waitUntil: 'domcontentloaded' })
    await sleep(4000)

    // Selectors for Add to Cart / Add to Bag across Target AU and Target US
    const addToCartLocator = page
      .locator(
        'button[data-test="shipItButton"], button[data-test="shippingButton"], button[data-test="add-to-cart-button"], button[id="add-to-cart-button"], button[aria-label*="Add to cart"], button[aria-label*="Add to bag"], button:has-text("Add to bag"), button:has-text("Add to cart")'
      )
      .first()

    console.log('Checking stock on Target...')
    while (true) {
      try {
        await addToCartLocator.waitFor({ state: 'visible', timeout: 8000 })
        const isDisabled = await addToCartLocator.isDisabled()
        if (!isDisabled) {
          console.log('Item in stock! Clicking Add to Cart / Bag...')
          await addToCartLocator.click()
          break
        }
        throw new Error('Button disabled or not ready')
      } catch (error) {
        console.log('Waiting for stock. Refreshing in 15s...')
        await sleep(15000)
        await page.reload({ waitUntil: 'domcontentloaded' })
      }
    }

    await sleep(4000)

    // Decline coverage if protection modal pops up (Target US)
    const noCoverageButton = page
      .locator('button[data-test="espModalContent-declineCoverageButton"]')
      .first()
    if (await noCoverageButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await noCoverageButton.click()
      await sleep(2000)
    }

    // View Cart / Checkout
    const viewCartButton = page
      .locator(
        'button[data-test="addToCartModalViewCartCheckout"], a[href*="/cart"], a[data-testid="view-bag"]'
      )
      .first()
    if (await viewCartButton.isVisible({ timeout: 4000 }).catch(() => false)) {
      await viewCartButton.click()
    } else {
      const cartUrl = isTargetAU
        ? 'https://www.target.com.au/cart'
        : 'https://www.target.com/cart'
      await page.goto(cartUrl, { waitUntil: 'domcontentloaded' })
    }

    await sleep(5000)

    const checkoutButton = page
      .locator(
        'button[data-test="checkout-button"], button[data-testid="checkout-button"], a[href*="/checkout"]'
      )
      .first()
    if (await checkoutButton.isVisible({ timeout: 6000 }).catch(() => false)) {
      await checkoutButton.click()
    }

    await sleep(5000)

    // Fill address details (AU and US compatible)
    const addressToUse = address || ''
    const suburbToUse = suburb || city || ''
    const postcodeToUse = postcode || zipCode || ''

    const nameField = page
      .locator('input[name="fullName"], input[id="full_name"], input[name="firstName"]')
      .first()
    if (firstName && (await nameField.isVisible({ timeout: 4000 }).catch(() => false))) {
      await nameField.fill(`${firstName} ${lastName || ''}`)
    }

    const stateField = page.locator('select[name="state"], select[id="state"]').first()
    if (state && (await stateField.isVisible({ timeout: 2000 }).catch(() => false))) {
      await stateField.selectOption(state).catch(() => {})
    }

    const addressField = page
      .locator('input[name="addressLine1"], input[id="address_line1"], input[name="address1"]')
      .first()
    if (addressToUse && (await addressField.isVisible({ timeout: 2000 }).catch(() => false))) {
      await addressField.fill(addressToUse)
    }

    const suburbField = page
      .locator('input[name="suburb"], input[id="city"], input[name="city"]')
      .first()
    if (suburbToUse && (await suburbField.isVisible({ timeout: 2000 }).catch(() => false))) {
      await suburbField.fill(suburbToUse)
    }

    const postcodeField = page
      .locator('input[name="postcode"], input[id="zip_code"], input[name="zipCode"]')
      .first()
    if (postcodeToUse && (await postcodeField.isVisible({ timeout: 2000 }).catch(() => false))) {
      await postcodeField.fill(postcodeToUse)
    }

    const phoneField = page
      .locator('input[name="phone"], input[id="mobile"], input[name="phoneNumber"]')
      .first()
    if (phoneNumber && (await phoneField.isVisible({ timeout: 2000 }).catch(() => false))) {
      await phoneField.fill(phoneNumber)
    }

    // Payment fields
    const cardField = page
      .locator('input[name="creditCard"], input[id="creditCardInput-cardNumber"]')
      .first()
    if (creditCardNumber && (await cardField.isVisible({ timeout: 4000 }).catch(() => false))) {
      await cardField.fill(creditCardNumber)
    }

    const expiryField = page
      .locator('input[name="expiration"], input[id="creditCardInput-expiration"]')
      .first()
    if (expirationMonth && expirationYear && (await expiryField.isVisible({ timeout: 2000 }).catch(() => false))) {
      await expiryField.fill(`${expirationMonth}/${expirationYear.slice(-2)}`)
    }

    const cvvField = page
      .locator('input[name="cvv"], input[id="creditCardInput-cvv"]')
      .first()
    if (cvv && (await cvvField.isVisible({ timeout: 2000 }).catch(() => false))) {
      await cvvField.fill(cvv)
    }

    notifier.notify({
      title: isTargetAU ? 'Target Australia' : 'Target',
      message: 'Ready to place order!',
      sound: true
    })

    // ── CHECKOUT DISABLED FOR TESTING ──────────────────────────────────────────
    // Uncomment lines below when ready to auto-submit:
    // const placeOrderButton = page.locator('button[data-test="placeOrderButton"], button[data-testid="place-order"]').first()
    // if (await placeOrderButton.isVisible()) await placeOrderButton.click()
    // ───────────────────────────────────────────────────────────────────────────
  } catch (error) {
    console.error('Target error:', error)
  } finally {
    // Keep browser session open for user review
  }
}

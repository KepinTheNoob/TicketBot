import * as notifier from 'node-notifier'
import { launchBrowser } from './browser-util'
import { Locator } from 'playwright'

// Helper: Dynamic random delays for human-like pauses
const randomDelay = (min: number, max: number) => 
  new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)))

// Helper: Spoof keystroke dynamics to avoid behavioral detection
const humanType = async (locator: Locator, text: string) => {
  if (!text) return
  await locator.focus()
  await locator.clear()
  // pressSequentially types character by character with a randomized delay
  await locator.pressSequentially(text, { delay: Math.floor(Math.random() * 80) + 30 })
  await randomDelay(100, 300)
}

export const scrapeTarget = async (config: { [key: string]: string }) => {
  const {
    phoneNumber, firstName, lastName, state, city, suburb, zipCode,
    postcode, address, creditCardNumber, expirationMonth, expirationYear,
    cvv, targetEmail, targetPassword, targetLink
  } = config

  if (!targetLink) {
    throw new Error('targetLink setting not set in config.json')
  }

  const { page } = await launchBrowser('./playwright_data_target')

  try {
    page.setDefaultTimeout(30000) // Lowered global timeout to fail faster

    const isTargetAU = targetLink.includes('target.com.au')

    // Optional Login Flow (US)
    if (!isTargetAU && targetEmail && targetPassword) {
      try {
        await page.goto('https://www.target.com', { waitUntil: 'domcontentloaded' })
        
        const accountDropdown = page.locator('#account, button[data-test="@web/AccountLink"], a[id="account"]').first()
        await accountDropdown.waitFor({ state: 'visible', timeout: 5000 })
        await accountDropdown.click()

        const signInButton = page.locator('#accountNav-signIn, a[data-test="accountNav-signIn"]').first()
        await signInButton.waitFor({ state: 'visible', timeout: 5000 })
        await signInButton.click()

        const usernameInput = page.locator('#username').first()
        await usernameInput.waitFor({ state: 'visible', timeout: 5000 })
        
        // Use human typing instead of instant fill
        await humanType(usernameInput, targetEmail)
        await humanType(page.locator('#password').first(), targetPassword)
        
        await page.keyboard.press('Enter')
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
      } catch (loginError) {
        console.log('Target login skipped/failed. Proceeding as guest.', loginError?.message)
      }
    }

    console.log(`Navigating to Target product: ${targetLink}`)
    await page.goto(targetLink, { waitUntil: 'domcontentloaded' })

    const addToCartLocator = page.locator(
      'button[data-test="shipItButton"]:not([disabled]), button[data-test="shippingButton"]:not([disabled]), button:has-text("Add to basket"):not([disabled]), button:has-text("Add to cart"):not([disabled])'
    ).first()

    console.log('Checking stock on Target...')
    
    // Bounded Retry Loop: Try up to 50 times instead of while(true)
    const MAX_ATTEMPTS = 50
    let addedToCart = false

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const pageTitle = await page.title()
        if (pageTitle.toLowerCase().includes('access denied') || pageTitle.includes('403')) {
          throw new Error(`WAF Block detected. Proxy burned.`)
        }

        // Bumped timeout to 20s to account for Target's deliberate JS gray-out delay under load
        await addToCartLocator.waitFor({ state: 'visible', timeout: 20000 })
        
        console.log(`Item in stock (Attempt ${attempt})! Simulating human reaction...`)
        
        // 1. Perception Delay: Wait for a human-like reaction time before moving the mouse
        await randomDelay(600, 1200)
        
        // 2. Telemetry Spoofing: Get the button's bounding box to calculate an off-center click
        const box = await addToCartLocator.boundingBox()
        if (!box) {
          throw new Error('Could not find bounding box for Add to Cart button')
        }

        // Calculate a random click coordinate within the button, avoiding the edges and dead center
        const randomX = Math.floor(Math.random() * (box.width * 0.6)) + (box.width * 0.2)
        const randomY = Math.floor(Math.random() * (box.height * 0.6)) + (box.height * 0.2)

        // 3. Humanize the interaction: Hover, delay, and click at the randomized offset
        await addToCartLocator.hover({ position: { x: randomX, y: randomY } })
        await randomDelay(200, 500)
        await addToCartLocator.click({ 
          position: { x: randomX, y: randomY },
          delay: Math.floor(Math.random() * 120) + 60 
        })

        // Wait for the backend GraphQL/REST network request to actually finish
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
        
        addedToCart = true
        break // Escape loop on success
      } catch (error) {
        console.log(`Waiting for stock (Attempt ${attempt}/${MAX_ATTEMPTS}). Refreshing...`)
        await randomDelay(8000, 12000)
        await page.reload({ waitUntil: 'domcontentloaded' })
      }
    }

    if (!addedToCart) {
      throw new Error('Failed to add to cart after maximum attempts. Exiting to prevent memory leak.')
    }

    // Modal cleanup
    const closePopupButton = page.locator('button[aria-label*="close" i], button.lightbox-close, [data-test="modal-close"], button:has-text("✕")').first()
    if (await closePopupButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closePopupButton.click()
    }

    const cartUrl = isTargetAU ? 'https://www.target.com.au/spc/basket/' : 'https://www.target.com/cart'
    await page.goto(cartUrl, { waitUntil: 'domcontentloaded' })
    
    // Intercept empty carts immediately to prevent infinite checkout hangs
    const emptyCartText = page.locator('text="0 ITEMS", text="your basket is empty"').first()
    if (await emptyCartText.isVisible({ timeout: 5000 }).catch(() => false)) {
      throw new Error("Target API secretly rejected the Add to Cart request (WAF block). Cart is empty. Aborting.")
    }

    // Wait for cart DOM to settle dynamically
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    const checkoutButton = page.locator(
      'button[data-test="checkout-button"], a[href*="/checkout"], button:has-text("Checkout")'
    ).first()
    
    await checkoutButton.waitFor({ state: 'visible', timeout: 10000 })
    await checkoutButton.click()

    // Handle Guest Checkout prompt dynamically
    const guestCheckoutButton = page.locator('button:has-text("Checkout as guest"), a:has-text("guest")').first()
    if (await guestCheckoutButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await guestCheckoutButton.click()
      await page.waitForLoadState('domcontentloaded')
    }

    // Checkout Details - using humanType to spoof interaction
    const addressToUse = address || ''
    const suburbToUse = suburb || city || ''
    const postcodeToUse = postcode || zipCode || ''

    const nameField = page.locator('input[name="fullName"], input[name="firstName"]').first()
    if (await nameField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await humanType(nameField, `${firstName} ${lastName || ''}`)
    }

    const addressField = page.locator('input[name="addressLine1"], input[name="address1"]').first()
    if (await addressField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await humanType(addressField, addressToUse)
    }

    const suburbField = page.locator('input[name="suburb"], input[id="city"], input[name="city"]').first()
    if (await suburbField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await humanType(suburbField, suburbToUse)
    }

    const stateField = page.locator('select[name="state"], select[id="state"]').first()
    if (state && await stateField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await stateField.selectOption(state).catch(() => {})
    }

    const postcodeField = page.locator('input[name="postcode"], input[name="zipCode"]').first()
    if (await postcodeField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await humanType(postcodeField, postcodeToUse)
    }

    const phoneField = page.locator('input[name="phone"], input[name="phoneNumber"]').first()
    if (await phoneField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await humanType(phoneField, phoneNumber)
    }

    // Continue to payment
    const continuePaymentButton = page.locator('button:has-text("Continue"), button:has-text("Proceed to payment")').first()
    if (await continuePaymentButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await continuePaymentButton.click()
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    }

    // Payment Details
    const cardField = page.locator('input[name="creditCard"], input[id*="cardNumber"]').first()
    if (await cardField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await humanType(cardField, creditCardNumber)
    }

    const expiryField = page.locator('input[name="expiration"], input[id*="expiration"]').first()
    if (await expiryField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await humanType(expiryField, `${expirationMonth}/${expirationYear.slice(-2)}`)
    }

    const cvvField = page.locator('input[name="cvv"], input[id*="cvv"]').first()
    if (await cvvField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await humanType(cvvField, cvv)
    }

    notifier.notify({
      title: isTargetAU ? 'Target Australia' : 'Target',
      message: 'Ready to place order! Automation paused.',
      sound: true
    })

  } catch (error) {
    console.error('Target scraper encountered a fatal error:', error)
  } finally {
    // Session kept open for manual review
  }
}
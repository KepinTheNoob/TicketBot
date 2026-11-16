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
          .locator(
            '#account, button[data-test="@web/AccountLink"], a[id="account"]'
          )
          .first()
        if (
          await accountDropdown.isVisible({ timeout: 8000 }).catch(() => false)
        ) {
          await accountDropdown.click()
          await sleep(2000)
        }

        const signInButton = page
          .locator('#accountNav-signIn, a[data-test="accountNav-signIn"]')
          .first()
        if (
          await signInButton.isVisible({ timeout: 4000 }).catch(() => false)
        ) {
          await signInButton.click()
          await sleep(3000)
        }

        const usernameInput = page.locator('#username').first()
        if (
          await usernameInput.isVisible({ timeout: 4000 }).catch(() => false)
        ) {
          await usernameInput.fill(targetEmail)
          await page
            .locator('#password')
            .first()
            .fill(targetPassword)
          await page.keyboard.press('Enter')
          await sleep(5000)
        }
      } catch (loginError) {
        console.log('Target login notice:', loginError?.message || loginError)
      }
    }

    console.log(`Navigating to Target product: ${targetLink}`)
    await page.goto(targetLink, { waitUntil: 'domcontentloaded' })
    await sleep(4000)

    // Selectors for Add to Cart / Add to Bag across Target AU and Target US
    const addToCartLocator = page
      .locator(
        'button[data-test="shipItButton"]:not([disabled]):not([aria-disabled="true"]), button[data-test="shippingButton"]:not([disabled]):not([aria-disabled="true"]), button[data-test="add-to-cart-button"]:not([disabled]):not([aria-disabled="true"]), button[id="add-to-cart-button"]:not([disabled]):not([aria-disabled="true"]), button:has-text("Add to basket"):not([disabled]):not([aria-disabled="true"]), button:has-text("Add to bag"):not([disabled]):not([aria-disabled="true"]), button:has-text("Add to cart"):not([disabled]):not([aria-disabled="true"]), button:has-text("Add to delivery"):not([disabled]):not([aria-disabled="true"])'
      )
      .first()

    console.log('Checking stock on Target...')
    while (true) {
      try {
        const pageTitle = await page.title()
        if (
          pageTitle.toLowerCase().includes('access denied') ||
          pageTitle.toLowerCase().includes('just a moment') ||
          pageTitle.includes('403')
        ) {
          throw new Error(`Blocked page detected (Title: "${pageTitle}")`)
        }

        // Tunggu hingga 25 detik agar tombol abu-abu selesai loading & berubah hitam
        await addToCartLocator.waitFor({ state: 'visible', timeout: 25000 })
        const btnText = ((await addToCartLocator.textContent()) || '').trim()

        console.log(
          `Item in stock ("${btnText}")! Clicking Add to Cart / Bag...`
        )
        await addToCartLocator.click()
        break
      } catch (error) {
        const rawBtnHtml = await page
          .locator(
            'button:has-text("Add To Basket"), button:has-text("Add to bag")'
          )
          .first()
          .evaluate(el => el.outerHTML)
          .catch(() => 'Button not found in DOM')

        console.log(
          `Waiting for stock | Reason: ${error?.message?.split('\n')[0] ||
            'not ready'}`
        )
        console.log(`Button state:`, rawBtnHtml)
        console.log(`Refreshing in 15s...`)

        await sleep(15000)
        await page.reload({ waitUntil: 'domcontentloaded' })
      }
    }
    await sleep(4000)

    // Decline coverage if protection modal pops up (Target US)
    const noCoverageButton = page
      .locator('button[data-test="espModalContent-declineCoverageButton"]')
      .first()
    if (
      await noCoverageButton.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      await noCoverageButton.click()
      await sleep(2000)
    }

    // View Cart / Checkout
    // 1. Tutup popup "Often Bought Together" secara eksplisit dengan mengklik tombol X atau Escape
    const closePopupButton = page
      .locator(
        'button[aria-label*="close" i], button.lightbox-close, [data-test="modal-close"], button:has-text("✕")'
      )
      .first()
    if (
      await closePopupButton.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      await closePopupButton.click()
      await sleep(1000)
    } else {
      await page.keyboard.press('Escape')
      await sleep(1000)
    }

    // 2. Klik tombol View basket yang asli dari modal atau header
    const viewCartButton = page
      .locator(
        'button:has-text("View basket"):visible, a:has-text("View basket"):visible, a[href*="/basket" i]:visible, a[aria-label*="basket" i]:visible, button:has-text("View Cart"):visible'
      )
      .first()
    if (await viewCartButton.isVisible({ timeout: 4000 }).catch(() => false)) {
      await viewCartButton.click({ force: true })
      await sleep(3000)
    }

    // Jika URL masih tertahan di halaman produk (/p/), buka /spc/basket/ untuk Target AU
    if (page.url().includes('/p/')) {
      const cartUrl = isTargetAU
        ? 'https://www.target.com.au/spc/basket/'
        : 'https://www.target.com/cart'
      await page.goto(cartUrl, { waitUntil: 'domcontentloaded' })
    }

    // Tunggu halaman /spc/basket/ selesai loading (maksimal 25 detik sampai tombol selain footer muncul)
    console.log('Waiting for Target basket page to finish loading...')
    await page
      .waitForFunction(
        () => {
          const btns = Array.from(document.querySelectorAll('button'))
            .map(b => b.innerText.trim())
            .filter(
              t => t && t !== 'Conditions of use' && t !== 'Privacy policy'
            )
          return btns.length > 0
        },
        { timeout: 25000 }
      )
      .catch(() =>
        console.log('Basket page still loading or empty after 25s...')
      )

    // Select delivery method on Target AU cart if required to enable checkout
    if (isTargetAU) {
      const deliveryOption = page
        .locator(
          'label:has-text("Delivery"), input[value*="delivery" i], div:has-text("Home Delivery")'
        )
        .first()
      if (
        await deliveryOption.isVisible({ timeout: 2000 }).catch(() => false)
      ) {
        await deliveryOption.click().catch(() => {})
        await sleep(2000)
      }
    }

    const checkoutButton = page
      .locator(
        'div[data-testid="bagToCheckout"] button, button[data-test="checkout-button"], button[data-testid="checkout-button"], a[href*="/checkout"], button:has-text("Continue to delivery"), button:has-text("Continue to details"), button:has-text("Checkout"), button:has-text("Proceed to checkout")'
      )
      .first()

    if (
      !(await checkoutButton.isVisible({ timeout: 5000 }).catch(() => false))
    ) {
      const btns = await page
        .locator('button:visible')
        .allInnerTexts()
        .catch(() => [])
      console.log('Basket URL:', page.url(), '| Visible buttons:', btns)
    }

    await checkoutButton.waitFor({ state: 'visible', timeout: 15000 })
    await checkoutButton.click()

    await sleep(4000)

    // Handle Guest Checkout prompt if shown
    const guestCheckoutButton = page
      .locator(
        'button:has-text("Checkout as guest"), button:has-text("Continue as guest"), a:has-text("guest")'
      )
      .first()
    if (
      await guestCheckoutButton.isVisible({ timeout: 4000 }).catch(() => false)
    ) {
      await guestCheckoutButton.click()
      await sleep(4000)
    }

    // Fill address details (AU and US compatible)
    const addressToUse = address || ''
    const suburbToUse = suburb || city || ''
    const postcodeToUse = postcode || zipCode || ''

    const nameField = page
      .locator(
        'input[name="fullName"], input[id="full_name"], input[name="firstName"]'
      )
      .first()
    if (
      firstName &&
      (await nameField.isVisible({ timeout: 4000 }).catch(() => false))
    ) {
      await nameField.fill(`${firstName} ${lastName || ''}`)
    }

    const stateField = page
      .locator('select[name="state"], select[id="state"]')
      .first()
    if (
      state &&
      (await stateField.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
      await stateField.selectOption(state).catch(() => {})
    }

    const addressField = page
      .locator(
        'input[name="addressLine1"], input[id="address_line1"], input[name="address1"]'
      )
      .first()
    if (
      addressToUse &&
      (await addressField.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
      await addressField.fill(addressToUse)
    }

    const suburbField = page
      .locator('input[name="suburb"], input[id="city"], input[name="city"]')
      .first()
    if (
      suburbToUse &&
      (await suburbField.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
      await suburbField.fill(suburbToUse)
    }

    const postcodeField = page
      .locator(
        'input[name="postcode"], input[id="zip_code"], input[name="zipCode"]'
      )
      .first()
    if (
      postcodeToUse &&
      (await postcodeField.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
      await postcodeField.fill(postcodeToUse)
    }

    const phoneField = page
      .locator(
        'input[name="phone"], input[id="mobile"], input[name="phoneNumber"]'
      )
      .first()
    if (
      phoneNumber &&
      (await phoneField.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
      await phoneField.fill(phoneNumber)
    }

    // Advance from shipping step to payment step if multi-step checkout
    const continuePaymentButton = page
      .locator(
        'button:has-text("Continue"), button:has-text("Save & continue"), button:has-text("Proceed to payment")'
      )
      .first()
    if (
      await continuePaymentButton
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await continuePaymentButton.click()
      await sleep(4000)
    }

    // Payment fields
    const cardField = page
      .locator(
        'input[name="creditCard"], input[id="creditCardInput-cardNumber"]'
      )
      .first()
    if (
      creditCardNumber &&
      (await cardField.isVisible({ timeout: 4000 }).catch(() => false))
    ) {
      await cardField.fill(creditCardNumber)
    }

    const expiryField = page
      .locator(
        'input[name="expiration"], input[id="creditCardInput-expiration"]'
      )
      .first()
    if (
      expirationMonth &&
      expirationYear &&
      (await expiryField.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
      await expiryField.fill(`${expirationMonth}/${expirationYear.slice(-2)}`)
    }

    const cvvField = page
      .locator('input[name="cvv"], input[id="creditCardInput-cvv"]')
      .first()
    if (
      cvv &&
      (await cvvField.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
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

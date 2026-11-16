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
        'button[data-testid="product-button"], div.product-button-container button, button.product-button'
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
        const btnText = ((await addToBagLocator.textContent()) || '').trim().toLowerCase()
        const isDisabled = await addToBagLocator.isDisabled()

        if (
          !isDisabled &&
          (btnText.includes('add to bag') ||
            btnText.includes('add to cart') ||
            btnText.includes('add to delivery'))
        ) {
          console.log(`Item in stock! Button text: "${btnText}".`)

          // 1. Scroll button to center
          await addToBagLocator.scrollIntoViewIfNeeded()
          await sleep(600)

          // 2. Set up listener for Kmart's cart GraphQL response
          const cartResponsePromise = page
            .waitForResponse(
              res => {
                const url = res.url().toLowerCase()
                return (
                  (url.includes('graphql') ||
                    url.includes('cart') ||
                    url.includes('bag')) &&
                  res.status() === 200
                )
              },
              { timeout: 7000 }
            )
            .catch(() => null)

          // 3. Dispatch click
          console.log('Clicking "Add to bag" button...')
          await page.evaluate(() => {
            const btn = document.querySelector('button[data-testid="product-button"]') as HTMLElement
            if (btn) {
              btn.focus()
              btn.click()
            }
          })
          await addToBagLocator.click({ force: true }).catch(() => {})

          console.log('Waiting for Add to Bag confirmation from Kmart...')
          await cartResponsePromise

          // 4. Check if confirmation drawer/popup appears (with "View bag" button)
          const drawerBtn = page
            .locator(
              'button[data-testid="view-bag"], a[data-testid="view-bag"], button[data-testid*="view-bag"], button[data-testid*="checkout"], a[href*="/checkout/bag"], a[href*="/bag"], div[class*="MiniCart"] a, div[class*="Drawer"] a, div[class*="drawer"] a'
            )
            .first()

          if (await drawerBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            console.log('Confirmation drawer detected! Clicking "View bag" in drawer...')
            await drawerBtn.click().catch(() => {})
            await sleep(3000)
          } else {
            console.log('No mini-bag drawer popup detected, waiting for cart session to persist...')
            await sleep(3000)
          }

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

    // Navigate to Bag / Cart if not already navigated via drawer
    if (!page.url().includes('/checkout')) {
      console.log('Navigating directly to Kmart checkout bag...')
      await page.goto('https://www.kmart.com.au/checkout/bag', {
        waitUntil: 'domcontentloaded'
      })
    }

    console.log('On Kmart bag & checkout page...')
    await sleep(4000)

    // Verify bag is not empty
    const isBagEmpty = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase()
      return text.includes('your bag is empty') || text.includes('bag is empty')
    })
    if (isBagEmpty) {
      console.warn('⚠️ WARNING: Bag appears to be empty on checkout page! Check if item was added properly.')
    } else {
      console.log('✅ Bag confirmed with item.')
    }

    // Handle "To suburb or postcode" input field ONLY if empty
    // (If already pre-filled like "SYDNEY NSW 2000", changing it breaks Kmart's quote and redirects to home)
    const postcodeInput = page
      .locator('input[data-testid="postcode-autosuggest-input"], input[aria-label*="suburb or postcode"]')
      .first()

    if ((postcode || suburb) && (await postcodeInput.isVisible({ timeout: 4000 }).catch(() => false))) {
      const currentVal = await postcodeInput.inputValue()
      if (!currentVal.trim()) {
        const targetLocation = postcode || suburb
        console.log(`Entering delivery postcode: ${targetLocation}...`)
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
        console.log(`Delivery location already quoted as "${currentVal}". Keeping it to prevent session reset.`)
      }
    }

    // Step 1 (Bag): Click "Continue to details" button
    // Exact selector: div[data-testid="bagToCheckout"] button, button[data-testid="checkout-button"]
    const continueBtn = page
      .locator(
        'div[data-testid="bagToCheckout"] button, button[data-testid="checkout-button"]'
      )
      .first()

    console.log('Waiting for "Continue to details" button...')
    await continueBtn.waitFor({ state: 'visible', timeout: 15000 })
    console.log('Clicking Continue to details...')
    await continueBtn.click({ timeout: 15000 })
    await sleep(4000)

    // Step 2: Fill Details (Email, Name, Phone)
    const emailField = page
      .locator('input[data-testid="email"], input[name="email"], input[id="email"]')
      .first()
    if (email && (await emailField.isVisible({ timeout: 4000 }).catch(() => false))) {
      console.log('Entering email...')
      await emailField.fill(email)
    }

    const firstNameField = page
      .locator('input[data-testid="firstName"], input[name="firstName"], input[id="firstName"]')
      .first()
    if (firstName && (await firstNameField.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('Entering first name...')
      await firstNameField.fill(firstName)
    }

    const lastNameField = page
      .locator('input[data-testid="lastName"], input[name="lastName"], input[id="lastName"]')
      .first()
    if (lastName && (await lastNameField.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('Entering last name...')
      await lastNameField.fill(lastName)
    }

    const phoneField = page
      .locator('input[data-testid="phone"], input[name="phone"], input[id="phone"]')
      .first()
    if (phoneNumber && (await phoneField.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('Entering phone number...')
      await phoneField.fill(phoneNumber)
    }

    // Advance to Step 3: Delivery
    // Exact button: <button type="submit" data-testid="continueToDeliveryButton">
    const continueToDeliveryBtn = page
      .locator('button[data-testid="continueToDeliveryButton"]')
      .first()
    if (await continueToDeliveryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Clicking Continue to delivery button...')
      await continueToDeliveryBtn.click()
      await sleep(4000)
    }

    // Step 3: Fill Delivery (Address)
    console.log('On Kmart Delivery step, entering address...')
    const addressField = page
      .locator('input[data-testid="addressInfo"], input[id="addressInfo"], input[name="address1"]')
      .first()
    if (addressField && (await addressField.isVisible({ timeout: 4000 }).catch(() => false))) {
      const addressToType = address || '1 George Street Sydney'
      console.log(`Entering address: ${addressToType}...`)
      await addressField.click()
      await addressField.fill(addressToType)

      // Wait for Kmart's address auto-suggest listbox to appear and click the first option
      console.log('Waiting for address auto-suggest option...')
      try {
        const firstOption = page
          .locator('#addressInfo-option-0, li.MuiAutocomplete-option, li[role="option"]')
          .first()
        await firstOption.waitFor({ state: 'visible', timeout: 8000 })
        console.log('Selecting first address suggestion from dropdown...')
        await firstOption.click()
      } catch (_) {
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
      }
      await sleep(2000)
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

    // Advance to Step 4: Payment
    // Wait for continueToPaymentButton to become ENABLED (Kmart takes 3-4s for GraphQL validation)
    const continueToPaymentBtn = page.locator('button[data-testid="continueToPaymentButton"]').first()
    console.log('Waiting for Continue to payment button to be enabled...')
    await continueToPaymentBtn.waitFor({ state: 'visible', timeout: 15000 })

    await page
      .waitForFunction(
        () => {
          const btn = document.querySelector('button[data-testid="continueToPaymentButton"]') as HTMLButtonElement
          return btn && !btn.disabled
        },
        null,
        { timeout: 15000 }
      )
      .catch(() => {})

    console.log('Clicking Continue to payment button...')
    await continueToPaymentBtn.click({ timeout: 10000 })
    await sleep(5000)

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
    //   await placeOrderButton.click()
    // }
    // ───────────────────────────────────────────────────────────────────────────
  } catch (error) {
    console.error('Kmart error:', error)
  } finally {
    // Browser session kept open for user review
  }
}

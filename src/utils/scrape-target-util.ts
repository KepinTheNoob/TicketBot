import * as notifier from 'node-notifier'
import { launchBrowser, setupPage } from './browser-util'

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

  const browser = await launchBrowser('./puppeteer_data_target')

  try {
    const page = await browser.newPage()
    await setupPage(page)
    await page.setDefaultNavigationTimeout(60000)

    const isTargetAU = targetLink.includes('target.com.au')

    // Only attempt Target.com sign in if navigating to Target US and credentials exist
    if (!isTargetAU && targetEmail && targetPassword) {
      try {
        await page.goto('https://www.target.com')
        await page.waitForSelector(
          '#account, button[data-test="@web/AccountLink"], a[id="account"]',
          { timeout: 8000 }
        )
        const accountDropdown = await page.$(
          '#account, button[data-test="@web/AccountLink"], a[id="account"]'
        )
        if (accountDropdown) {
          await accountDropdown.click()
          await sleep(3000)
        }

        const signInButton = await page.$(
          '#accountNav-signIn, a[data-test="accountNav-signIn"]'
        )
        if (signInButton) {
          await signInButton.click()
          await sleep(4000)
        }

        const usernameInput = await page.$('#username')
        if (usernameInput) {
          await page.type('#username', targetEmail)
          await page.type('#password', targetPassword)
          await page.keyboard.press('Enter')
          await sleep(6000)
        }
      } catch (loginError) {
        console.log(
          'Target login step notice:',
          loginError.message || loginError
        )
      }
    }

    console.log(`Navigating to Target product: ${targetLink}`)
    await page.goto(targetLink, { waitUntil: 'domcontentloaded' })
    await sleep(4000)

    // Selectors for Add to Cart / Add to Bag across Target AU and Target US
    const addToCartSelector =
      'button[data-test="shipItButton"], button[data-test="shippingButton"], button[data-test="add-to-cart-button"], button[id="add-to-cart-button"], button[aria-label*="Add to cart"], button[aria-label*="Add to bag"], button[aria-label*="Add to basket"]'

    console.log('Checking stock on Target...')
    while (true) {
      try {
        await page.waitForSelector(addToCartSelector, { timeout: 10000 })
        const btn = await page.$(addToCartSelector)
        if (btn) {
          const isDisabled = await page.evaluate(el => el.disabled, btn)
          if (!isDisabled) {
            console.log('Item in stock! Clicking Add to Cart / Bag...')
            await btn.click()
            break
          }
        }
        throw new Error('Button disabled or not ready')
      } catch (error) {
        console.log('Waiting for stock. Refreshing in 10s...')
        await sleep(10000)
        await page.reload({ waitUntil: 'domcontentloaded' })
      }
    }

    await sleep(4000)

    // Decline coverage if protection modal pops up (Target US)
    const noCoverageButton = await page.$(
      'button[data-test="espModalContent-declineCoverageButton"]'
    )
    if (noCoverageButton) {
      await noCoverageButton.click()
      await sleep(3000)
    }

    // View Cart / Checkout
    const viewCartButton = await page.$(
      'button[data-test="addToCartModalViewCartCheckout"], a[href*="/cart"], a[data-testid="view-bag"]'
    )
    if (viewCartButton) {
      await viewCartButton.click()
    } else {
      const cartUrl = isTargetAU
        ? 'https://www.target.com.au/cart'
        : 'https://www.target.com/cart'
      await page.goto(cartUrl, { waitUntil: 'domcontentloaded' })
    }

    await sleep(5000)

    const checkoutButton = await page.$(
      'button[data-test="checkout-button"], button[data-testid="checkout-button"], a[href*="/checkout"]'
    )
    if (checkoutButton) {
      await checkoutButton.click()
    }

    await sleep(5000)

    // Fill address details (AU and US compatible)
    const addressToUse = address || ''
    const suburbToUse = suburb || city || ''
    const postcodeToUse = postcode || zipCode || ''

    const nameField = await page.$(
      'input[name="fullName"], input[id="full_name"], input[name="firstName"]'
    )
    if (nameField && firstName) {
      await nameField.type(`${firstName} ${lastName || ''}`)
    }

    const stateField = await page.$('select[name="state"], select[id="state"]')
    if (stateField && state) {
      await page.select('select[name="state"], select[id="state"]', state)
    }

    const addressField = await page.$(
      'input[name="addressLine1"], input[id="address_line1"], input[name="address1"]'
    )
    if (addressField && addressToUse) {
      await addressField.type(addressToUse)
    }

    const suburbField = await page.$(
      'input[name="suburb"], input[id="city"], input[name="city"]'
    )
    if (suburbField && suburbToUse) {
      await suburbField.type(suburbToUse)
    }

    const postcodeField = await page.$(
      'input[name="postcode"], input[id="zip_code"], input[name="zipCode"]'
    )
    if (postcodeField && postcodeToUse) {
      await postcodeField.type(postcodeToUse)
    }

    const phoneField = await page.$(
      'input[name="phone"], input[id="mobile"], input[name="phoneNumber"]'
    )
    if (phoneField && phoneNumber) {
      await phoneField.type(phoneNumber)
    }

    // Payment fields
    const cardField = await page.$(
      'input[name="creditCard"], input[id="creditCardInput-cardNumber"]'
    )
    if (cardField && creditCardNumber) {
      await cardField.type(creditCardNumber)
    }

    const expiryField = await page.$(
      'input[name="expiration"], input[id="creditCardInput-expiration"]'
    )
    if (expiryField && expirationMonth && expirationYear) {
      await expiryField.type(`${expirationMonth}/${expirationYear.slice(-2)}`)
    }

    const cvvField = await page.$(
      'input[name="cvv"], input[id="creditCardInput-cvv"]'
    )
    if (cvvField && cvv) {
      await cvvField.type(cvv)
    }

    notifier.notify({
      title: isTargetAU ? 'Target Australia' : 'Target',
      message: 'Ready to place order!',
      sound: true
    })

    // ── CHECKOUT DISABLED FOR TESTING ──────────────────────────────────────────
    // Uncomment lines below when ready to auto-submit:
    // const placeOrderButton = await page.$(
    //   'button[data-test="placeOrderButton"], button[data-testid="place-order"]'
    // )
    // if (placeOrderButton) await placeOrderButton.click()
    // ───────────────────────────────────────────────────────────────────────────
  } catch (error) {
    console.error('Target error:', error)
  } finally {
    // Keep browser open for user review
  }
}

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
    await sleep(3000)

    // Helper: Cari tombol yang benar-benar bertuliskan "Add to cart" dan aktif (bukan Wishlist)
    const clickValidAddToCart = async (): Promise<boolean> => {
      return await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'))
        const targetBtn = buttons.find(btn => {
          const text = (btn.innerText || btn.textContent || '')
            .trim()
            .toLowerCase()
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase()
          const isWishlist =
            text.includes('wishlist') || aria.includes('wishlist')
          const isAddCart =
            text === 'add to cart' ||
            text === 'add to basket' ||
            aria.includes('add to cart')

          return (
            !isWishlist &&
            isAddCart &&
            !btn.disabled &&
            btn.offsetParent !== null
          )
        })

        if (targetBtn) {
          targetBtn.click()
          return true
        }
        return false
      })
    }

    console.log('Checking stock on Big W...')
    let consecutiveBlocks = 0
    const MAX_CONSECUTIVE_BLOCKS = 3

    while (true) {
      try {
        const pageTitle = await page.title()
        if (pageTitle.toLowerCase().includes('access denied')) {
          consecutiveBlocks++
          if (consecutiveBlocks > MAX_CONSECUTIVE_BLOCKS) {
            throw new Error(
              'Rate limit persisted after 3 retries. Stopping script to prevent further IP throttling.'
            )
          }

          const backoffMinutes = consecutiveBlocks * 5
          console.log(
            `Rate limit detected (${consecutiveBlocks}/${MAX_CONSECUTIVE_BLOCKS}). Cooling down for ${backoffMinutes} minutes...`
          )
          notifier.notify({
            title: 'Big W',
            message: `Rate limit detected. Cooling down for ${backoffMinutes} minutes...`,
            sound: false
          })

          await sleep(backoffMinutes * 60 * 1000)
          await page.goto(bigwLink, { waitUntil: 'domcontentloaded' })
          continue
        }

        consecutiveBlocks = 0

        const clicked = await clickValidAddToCart()
        if (clicked) {
          console.log('Item in stock! Clicked valid Add to Cart button.')
          break
        }

        throw new Error('Add to cart button not available or disabled')
      } catch (err) {
        if (err?.message?.includes('Rate limit persisted')) {
          throw err
        }

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

    await sleep(2000)

    // Cek apakah input postcode benar-benar VISIBLE di layar (bukan hidden element di DOM)
    const suburbSearchSelector =
      'input[aria-label*="Suburb search"], input.SuburbInputPrefix__input'
    const isDrawerVisible = await page.evaluate(sel => {
      const el = document.querySelector(sel) as HTMLElement | null
      return Boolean(el && el.offsetParent !== null)
    }, suburbSearchSelector)

    if (isDrawerVisible) {
      console.log('Delivery postcode side panel detected! Entering location...')
      const postcodeInputElement = await page.$(suburbSearchSelector)
      if (postcodeInputElement) {
        const locationValue = postcode || suburb || '2000'
        await postcodeInputElement.click()
        await postcodeInputElement.type(locationValue, { delay: 80 })
        await sleep(1500)

        const dropdownOption = await page.$(
          'div[class*="-option"], div[id*="react-select-"][id*="-option-0"]'
        )
        if (dropdownOption) {
          await dropdownOption.click()
        } else {
          await page.keyboard.press('Enter')
        }
        await sleep(1000)

        const saveDrawerButton = await page.$(
          'div[class*="ModalDrawerCTAContainer"] button, div[class*="ModalDrawer"] button'
        )
        if (saveDrawerButton) {
          console.log('Clicking Save on postcode drawer...')
          await saveDrawerButton.click()
          await sleep(2500)
        }

        // Re-click Add to Cart jika masih di halaman produk
        const reClicked = await clickValidAddToCart()
        if (reClicked) {
          console.log('Re-clicked Add to cart after saving location.')
          await sleep(2000)
        }
      }
    }

    // Navigasi eksplisit ke /cart dan verifikasi URL berubah
    console.log('Navigating to Big W cart page...')
    await page.goto('https://www.bigw.com.au/cart', {
      waitUntil: 'networkidle2'
    })

    if (!page.url().includes('/cart')) {
      throw new Error(`Failed to reach cart page. Current URL: ${page.url()}`)
    }

    // Pastikan cart tidak kosong sebelum menunggu tombol checkout
    const isCartEmpty = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase()
      return (
        bodyText.includes('your cart is empty') ||
        bodyText.includes('cart is currently empty')
      )
    })

    if (isCartEmpty) {
      throw new Error(
        'Navigated to /cart, but cart is empty (Add to Cart failed to register).'
      )
    }

    console.log('Confirmed on Big W cart page with item...')

    // Select delivery option radio button if available
    const deliveryRadioSelector =
      'li[role="radio"]:not(.selected), li[class*="RadioListWrapper"]:not([class*="Selected"])'
    const deliveryRadio = await page.$(deliveryRadioSelector)
    if (deliveryRadio) {
      console.log('Selecting delivery method radio button...')
      await deliveryRadio.click()
      await sleep(1500)
    }

    // Proceed to Checkout
    const checkoutButtonSelector =
      'button[data-testid="cart-submit-button"], button[data-di-id="cart--sign-in-to-checkout"], div[class*="CartSummaryActions"] button, button[data-test="checkout-button"]'

    console.log('Waiting for Proceed to checkout button...')
    await page.waitForSelector(checkoutButtonSelector, {
      visible: true,
      timeout: 15000
    })
    const checkoutButton = await page.$(checkoutButtonSelector)
    if (checkoutButton) {
      console.log('Clicking Proceed to checkout...')
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
          .catch(() => null),
        checkoutButton.click()
      ])
    }

    // Guest checkout handling
    const guestButtonSelector =
      'button[data-testid*="guest"], a[data-testid*="guest"], button[data-di-id*="guest"], a[href*="guest"]'
    const guestButton = await page.$(guestButtonSelector)
    if (guestButton) {
      console.log('Clicking Checkout as guest...')
      await guestButton.click()
      await sleep(3000)
    }

    // Fill delivery details if inputs exist
    const fillIfPresent = async (selector: string, value?: string) => {
      if (!value) return
      const el = await page.$(selector)
      if (el) await el.type(value, { delay: 30 })
    }

    await fillIfPresent('input[name="email"], input[id="email"]', email)
    await fillIfPresent(
      'input[name="firstName"], input[id="firstName"]',
      firstName
    )
    await fillIfPresent(
      'input[name="lastName"], input[id="lastName"]',
      lastName
    )
    await fillIfPresent(
      'input[name="phone"], input[name="phoneNumber"], input[id="phone"]',
      phoneNumber
    )
    await fillIfPresent(
      'input[name="address1"], input[name="streetAddress"], input[id="address"]',
      address
    )
    await fillIfPresent(
      'input[name="suburb"], input[name="city"], input[id="suburb"]',
      suburb
    )
    await fillIfPresent(
      'input[name="postcode"], input[name="postalCode"], input[id="postcode"]',
      postcode
    )

    const stateSelect = await page.$('select[name="state"], select[id="state"]')
    if (stateSelect && state) {
      await page.select('select[name="state"], select[id="state"]', state)
    }

    await sleep(2000)

    // Payment fields (Catatan: perlu dicek apakah berada di dalam iframe)
    await fillIfPresent(
      'input[name="cardNumber"], input[id="cardNumber"]',
      creditCardNumber
    )
    if (expirationMonth && expirationYear) {
      await fillIfPresent(
        'input[name="expiry"], input[name="cardExpiry"], input[id="expiry"]',
        `${expirationMonth}/${expirationYear.slice(-2)}`
      )
    }
    await fillIfPresent('input[name="cvv"], input[id="cvv"]', cvv)

    notifier.notify({
      title: 'Big W',
      message: 'Ready to place order!',
      sound: true
    })
  } catch (error) {
    console.error('Big W error:', error)
  } finally {
    // Browser kept open for user review
  }
}

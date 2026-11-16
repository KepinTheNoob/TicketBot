# BuyBot (Australia)

BuyBot is a stock scraper and auto-checkout bot adapted for Australian retailers: **Target Australia**, **Kmart Australia**, and **Big W**.

---

## Supported Retailers

| Retailer | Domain | Notes |
| :--- | :--- | :--- |
| **Target Australia** | [target.com.au](https://www.target.com.au) | Monitors "Add to cart / bag" buttons & checkout |
| **Kmart Australia** | [kmart.com.au](https://www.kmart.com.au) | Monitors delivery / bag availability & checkout |
| **Big W** | [bigw.com.au](https://www.bigw.com.au) | Monitors cart availability & checkout |

---

## Configuration

Your settings are read from `config.json` (which is `.gitignore`d for privacy). You can duplicate `configTemplate.json` (or `configTempalate.json`) to `config.json`:

```bash
cp configTemplate.json config.json
```

### Example `config.json`

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phoneNumber": "0412345678",
  "email": "email@example.com",
  "address": "123 George St",
  "suburb": "Sydney",
  "state": "NSW",
  "postcode": "2000",
  "creditCardNumber": "4111111111111111",
  "expirationMonth": "10",
  "expirationYear": "2027",
  "cvv": "123",
  "targetLink": "https://www.target.com.au/p/pokemon-tcg-mega-evolution-phantasmal-flames-blisters-assorted/72086971",
  "kmartLink": "https://www.kmart.com.au/product/...",
  "bigwLink": "https://www.bigw.com.au/product/..."
}
```

---

## Usage

### 1. Interactive Store Selector
```bash
node bin/BuyBot scrape
```
* Use the **UP / DOWN arrow keys** to navigate.
* Press the **SPACEBAR** to select / check a store (`◉`).
* Press **ENTER** to start the scraper.

### 2. Direct Store Commands
You can also launch a store directly by name:
```bash
node bin/BuyBot scrape kmart
node bin/BuyBot scrape bigw
node bin/BuyBot scrape target
```

---

## Safe Testing Mode

By default, the final order submission button in all scrapers (`src/utils/scrape-*-util.ts`) is **commented out**:
* The bot will monitor stock, click Add to Bag / Cart, navigate through checkout, fill in details, and trigger a desktop alert (`Ready to place order!`).
* The browser remains open on the final review screen so you can inspect everything without charging your card.

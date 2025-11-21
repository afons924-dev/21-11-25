import os
from playwright.sync_api import sync_playwright, Page, expect

def run_verification(page: Page):
    """
    Navigates to the product page, verifies the new sections, and takes a screenshot.
    """
    # 1. Arrange: Go to the homepage served by the local server.
    page.goto("http://localhost:8000")

    # Handle the age gate
    age_gate_enter_button = page.locator("#age-gate-enter")
    expect(age_gate_enter_button).to_be_visible(timeout=10000)
    age_gate_enter_button.click()

    # 2. Act: Find the specific product with multiple images and click it.
    # We wait for the featured carousel to be populated first.
    whisper_card = page.locator('.product-card:has-text("Vibrador Whisper")')
    expect(whisper_card).to_be_visible(timeout=15000)
    # We need to click the link within the card, not the card itself, to ensure navigation.
    whisper_card.get_by_role("link").first.click()

    # 3. Assert: Wait for the product detail page to load and check for new elements.
    # We expect the image gallery thumbnails to be visible.
    expect(page.locator("#product-gallery")).to_be_visible(timeout=10000)
    expect(page.locator("#product-thumbnails")).to_be_visible()

    # Also check for the new "Especificações" section
    expect(page.get_by_role("heading", name="Especificações")).to_be_visible()

    # And the "Também poderá gostar" section
    expect(page.get_by_role("heading", name="Também poderá gostar")).to_be_visible()

    # 4. Screenshot: Capture the final result for visual verification.
    page.wait_for_timeout(1000) # Wait for animations to settle
    screenshot_path = os.path.join(os.path.dirname(__file__), "verification.png")
    page.screenshot(path=screenshot_path, full_page=True)
    print(f"Screenshot saved to {screenshot_path}")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        run_verification(page)
        browser.close()

if __name__ == "__main__":
    main()

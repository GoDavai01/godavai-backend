# otc_apollo_thermometers.py
import csv, requests
from bs4 import BeautifulSoup

BASE = "https://www.apollopharmacy.in/shop-by-category/health-thermometers"
out = []

def scrape(page_url):
  html = requests.get(page_url, timeout=20).text
  s = BeautifulSoup(html, "html.parser")
  cards = s.select("[data-testid='plp-card'], .ProductCard_productCard__") or s.select("li,div")
  for c in cards:
    name = (c.get_text(" ", strip=True) or "")[:200]
    if "Thermometer" in name:
      # crude MRP pick; refine selector if needed
      price = None
      for t in ["Rs.", "₹", "MRP"]:
        if t in name: price = name.split(t)[-1].split()[0]; break
      out.append({"otc_category":"Thermometer","title":name, "mrp":price})

scrape(BASE)
# TODO: follow pagination if present

with open("otc_thermometers_apollo.csv","w",newline="",encoding="utf-8") as f:
  w = csv.DictWriter(f, fieldnames=["otc_category","title","mrp"])
  w.writeheader(); w.writerows(out)
print("Saved otc_thermometers_apollo.csv with", len(out), "rows")

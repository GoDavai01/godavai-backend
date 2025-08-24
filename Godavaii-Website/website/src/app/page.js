"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const screenshots = [
  "https://placehold.co/300x600/5eead4/fff?text=GoDavaii+App+1",
  "https://placehold.co/300x600/38bdf8/fff?text=GoDavaii+App+2",
  "https://placehold.co/300x600/818cf8/fff?text=GoDavaii+App+3",
];

export default function App() {
  const [screenshot, setScreenshot] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [year, setYear] = useState("");
  const [touchStartX, setTouchStartX] = useState(null);

  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  useEffect(() => {
    if (navOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [navOpen]);

  return (
    <div className="bg-gradient-to-br from-sky-50 via-white to-emerald-50 min-h-screen w-full font-sans overflow-x-hidden relative">
      // --- NAVBAR ---
<nav className="fixed top-0 left-0 w-full z-50 bg-white/80 shadow-lg border-b border-sky-100 backdrop-blur-lg flex justify-between items-center px-4 md:px-16 py-3 transition-all">
  <a href="#" className="flex items-center gap-2 select-none">
    <span className="text-2xl font-extrabold bg-gradient-to-r from-sky-600 to-emerald-400 bg-clip-text text-transparent tracking-tight">
      GoDavaii
    </span>
  </a>
  <div className="hidden md:flex gap-10 font-medium text-base">
    <a href="#features" className="hover:text-sky-600 transition">Features</a>
    <a href="#app preview" className="hover:text-sky-600 transition">App Preview</a>
    <a href="#download" className="hover:text-sky-600 transition">Download</a>
    <a href="#about" className="hover:text-sky-600 transition">About</a>
    <a href="#contact" className="hover:text-sky-600 transition">Contact</a>
  </div>
  <a href="#download" className="hidden md:block">
    <Button className="bg-sky-600 hover:bg-sky-700 text-white rounded-full px-6 py-2 shadow-md transition">
      Get App
    </Button>
  </a>
  {/* Mobile Hamburger */}
  <button
    className="md:hidden z-50 ml-2 p-2 rounded-md transition hover:bg-sky-100"
    onClick={() => setNavOpen(!navOpen)}
    aria-label="Toggle navigation"
  >
    <span className="block w-7 h-1 bg-sky-600 rounded mb-1"></span>
    <span className="block w-7 h-1 bg-sky-600 rounded mb-1"></span>
    <span className="block w-7 h-1 bg-sky-600 rounded"></span>
  </button>
</nav>

{/* -- MOBILE DRAWER, OUTSIDE <nav>! -- */}
{navOpen && (
  <div className="fixed inset-0 z-[9999] flex">
    {/* Backdrop */}
    <div
      className="fixed inset-0 bg-black/60 transition-opacity"
      onClick={() => setNavOpen(false)}
      aria-hidden="true"
    />
    {/* Drawer */}
    <div
      className="fixed right-0 top-0 h-full w-4/5 max-w-xs bg-white shadow-2xl border-l border-sky-100 flex flex-col py-8 px-7 z-[10000] animate-slide-in"
      style={{ minHeight: "100vh" }}
      onClick={e => e.stopPropagation()}
      // --- Swipe to close mobile nav ---
      onTouchStart={e => setTouchStartX(e.touches[0].clientX)}
      onTouchMove={e => {
        if (touchStartX !== null && e.touches[0].clientX - touchStartX < -60) {
          setNavOpen(false);
          setTouchStartX(null);
        }
      }}
      onTouchEnd={() => setTouchStartX(null)}
    >
      {/* Close Button */}
      <button
        className="ml-auto mb-8 text-3xl text-sky-600 font-bold"
        aria-label="Close navigation"
        onClick={() => setNavOpen(false)}
      >
        &times;
      </button>
      <nav className="flex flex-col gap-1">
        <a href="#features" className="py-4 border-b font-medium text-lg hover:text-sky-600" onClick={() => setNavOpen(false)}>Features</a>
        <a href="#app preview" className="py-4 border-b font-medium text-lg hover:text-sky-600" onClick={() => setNavOpen(false)}>App Preview</a>
        <a href="#download" className="py-4 border-b font-medium text-lg hover:text-sky-600" onClick={() => setNavOpen(false)}>Download</a>
        <a href="#about" className="py-4 border-b font-medium text-lg hover:text-sky-600" onClick={() => setNavOpen(false)}>About</a>
        <a href="#contact" className="py-4 border-b font-medium text-lg hover:text-sky-600" onClick={() => setNavOpen(false)}>Contact</a>
        <a href="#download" className="mt-8">
          <Button className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-full shadow text-base py-3">
            Get App
          </Button>
        </a>
      </nav>
    </div>
    <style jsx global>{`
      @keyframes slide-in {
        0% { transform: translateX(100%);}
        100% { transform: translateX(0);}
      }
      .animate-slide-in { animation: slide-in 0.25s cubic-bezier(.4,0,.2,1); }
    `}</style>
  </div>
)}

      {/* HERO */}
      <section className="relative flex flex-col justify-center items-center min-h-[90vh] pt-32 pb-16 px-4 md:px-0 mx-auto max-w-2xl md:max-w-4xl">
        {/* Fancy BG Blobs */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[120vw] h-[60vh] z-0 pointer-events-none">
          <div className="absolute w-[70vw] h-[40vh] left-1/2 -translate-x-1/2 bg-gradient-to-tr from-sky-300/40 via-violet-300/40 to-emerald-200/40 rounded-full blur-3xl" />
          <div className="absolute w-[40vw] h-[40vw] right-10 top-20 bg-gradient-to-tr from-emerald-400/40 to-sky-100/0 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col items-center w-full">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-sky-600 via-emerald-500 to-violet-500 bg-clip-text text-transparent mb-7 drop-shadow-2xl text-center leading-tight">
            Get Medicines Delivered <br className="md:hidden"/> <span className="text-sky-500">Under 30 Minutes</span>
          </h1>
          <p className="text-lg md:text-2xl text-gray-700/90 mb-10 max-w-2xl text-center md:text-left mx-auto">
            India’s fastest hyperlocal medicine delivery.<br />
            Real-time tracking. Trusted local pharmacies. <span className="font-semibold text-sky-500">24x7</span> support.
          </p>
          <div className="flex flex-col md:flex-row gap-4 w-full justify-center">
            <Button className="bg-sky-600 hover:bg-sky-700 text-white text-lg px-8 py-3 rounded-full shadow-xl transition duration-200 w-full md:w-auto">
              Download App
            </Button>
            <a href="#contact" className="w-full md:w-auto">
              <Button variant="outline" className="border-2 border-sky-600 text-sky-600 text-lg px-8 py-3 rounded-full shadow-xl hover:bg-sky-50 transition duration-200 w-full md:w-auto">
                Partner With Us
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-24 bg-gradient-to-br from-white/90 to-sky-50 px-4 md:px-0">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-14 text-gray-900 drop-shadow-lg">
          Why GoDavaii?
        </h2>
        <div className="mx-auto max-w-xl md:max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-10">
          <Card className="shadow-xl border-0 rounded-3xl bg-gradient-to-b from-sky-100/90 to-white/80 hover:scale-105 transition-all">
            <CardContent className="p-10 flex flex-col items-center">
              <span className="text-5xl mb-4 animate-bounce">⏱️</span>
              <h3 className="text-xl font-bold mb-2 text-sky-700">Ultra-fast Delivery</h3>
              <p className="text-center text-gray-700 text-base">Get medicines at your doorstep in <b>under 30 minutes</b>, always!</p>
            </CardContent>
          </Card>
          <Card className="shadow-xl border-0 rounded-3xl bg-gradient-to-b from-emerald-100/80 to-white/70 hover:scale-105 transition-all">
            <CardContent className="p-10 flex flex-col items-center">
              <span className="text-5xl mb-4">🏪</span>
              <h3 className="text-xl font-bold mb-2 text-emerald-700">Local Pharmacy Network</h3>
              <p className="text-center text-gray-700 text-base">Support local businesses & always get <b>authentic medicines</b> from trusted stores near you.</p>
            </CardContent>
          </Card>
          <Card className="shadow-xl border-0 rounded-3xl bg-gradient-to-b from-violet-100/80 to-white/70 hover:scale-105 transition-all">
            <CardContent className="p-10 flex flex-col items-center">
              <span className="text-5xl mb-4">🔔</span>
              <h3 className="text-xl font-bold mb-2 text-violet-700">Live Order Tracking</h3>
              <p className="text-center text-gray-700 text-base">Track your order live, get notified at every step. Total transparency.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* SCREENSHOTS CAROUSEL */}
      <section id="screenshots" className="py-24 bg-gradient-to-tl from-sky-50 to-white px-4 md:px-0">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-gray-900 drop-shadow">
          See GoDavaii in Action
        </h2>
        <div className="flex flex-col items-center mx-auto max-w-xl md:max-w-4xl">
          <div className="flex items-center gap-8">
            <Button
              variant="outline"
              className="rounded-full border-2 border-sky-400 hover:bg-sky-100 text-2xl w-12 h-12 flex items-center justify-center"
              onClick={() => setScreenshot((screenshot - 1 + screenshots.length) % screenshots.length)}
              aria-label="Previous Screenshot"
            >
              ◀
            </Button>
            <img
              src={screenshots[screenshot]}
              alt={`Screenshot ${screenshot + 1}`}
              className="rounded-3xl border-2 border-sky-200 shadow-2xl w-60 h-[30rem] object-cover transition-all duration-500 bg-white"
            />
            <Button
              variant="outline"
              className="rounded-full border-2 border-sky-400 hover:bg-sky-100 text-2xl w-12 h-12 flex items-center justify-center"
              onClick={() => setScreenshot((screenshot + 1) % screenshots.length)}
              aria-label="Next Screenshot"
            >
              ▶
            </Button>
          </div>
          <div className="mt-6 flex gap-2">
            {screenshots.map((_, idx) => (
              <button
                key={idx}
                className={`h-3 w-3 rounded-full border border-sky-400 transition-all ${idx === screenshot ? "bg-sky-500" : "bg-gray-200"}`}
                onClick={() => setScreenshot(idx)}
                aria-label={`Go to screenshot ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* DOWNLOAD */}
      <section id="download" className="py-20 flex flex-col items-center bg-white px-4 md:px-0">
        <div className="max-w-xl w-full text-center mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-5 text-gray-900">Download GoDavaii App</h2>
          <p className="text-gray-600 mb-7 text-base md:text-lg max-w-xl text-center mx-auto">
            Start your journey to faster, easier medicine delivery.
          </p>
          <div className="flex flex-col md:flex-row gap-6 mb-4 justify-center">
            <a href="#" className="transition-transform hover:scale-105">
              <img src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg" alt="Google Play" className="h-14" />
            </a>
            <a href="#" className="transition-transform hover:scale-105">
              <img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="App Store" className="h-14" />
            </a>
          </div>
        </div>
      </section>

      {/* ABOUT */}
      <section
        id="about"
        className="py-16 px-4 md:px-0 max-w-2xl md:max-w-3xl lg:max-w-4xl xl:max-w-6xl mx-auto flex flex-col items-center md:items-start"
      >
        <h2 className="text-3xl md:text-4xl font-bold mb-3 text-gray-900 text-center md:text-left w-full">
          About GoDavaii
        </h2>
        <p className="text-gray-600 text-base md:text-lg mb-6 w-full text-center md:text-left">
          GoDavaii is on a mission to revolutionize healthcare accessibility by empowering local pharmacies with technology.
          Whether it's midnight or a busy day, get what you need, when you need it—delivered quickly and securely.
        </p>
        <div className="w-full">
          <h3 className="text-xl font-bold mb-2 text-sky-700 text-center md:text-left">What makes us different?</h3>
          <ul className="text-left mx-auto max-w-md md:max-w-full text-gray-700 list-disc list-inside text-base md:text-lg space-y-2 mb-6">
            <li>
              <span className="font-semibold text-sky-600">Hyperlocal Speed:</span>
              {" "}Our network brings medicines to your door in record time, 24x7.
            </li>
            <li>
              <span className="font-semibold text-sky-600">Real Pharmacy Partners:</span>
              {" "}We empower local, trusted pharmacists in your neighborhood.
            </li>
            <li>
              <span className="font-semibold text-sky-600">Smart Tracking:</span>
              {" "}Live, real-time order updates at every step.
            </li>
            <li>
              <span className="font-semibold text-sky-600">Zero Compromises:</span>
              {" "}Authentic, fresh stock. Always reliable support.
            </li>
          </ul>
        </div>
        <div className="w-full flex flex-col md:flex-row gap-3 md:gap-6 items-center md:items-stretch justify-center mt-2">
          <div className="bg-white/70 border border-sky-100 rounded-xl px-6 py-4 text-gray-700 font-medium w-full md:w-1/3 shadow-sm">
            <span className="text-sky-500 font-bold">🏆 Innovation</span>: Tech-first healthcare solutions.
          </div>
          <div className="bg-white/70 border border-sky-100 rounded-xl px-6 py-4 text-gray-700 font-medium w-full md:w-1/3 shadow-sm">
            <span className="text-sky-500 font-bold">🤝 Community</span>: We grow with the local businesses we support.
          </div>
          <div className="bg-white/70 border border-sky-100 rounded-xl px-6 py-4 text-gray-700 font-medium w-full md:w-1/3 shadow-sm">
            <span className="text-sky-500 font-bold">🔒 Trust</span>: Data, privacy & your health are always protected.
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" className="py-20 bg-gradient-to-b from-white to-sky-50 px-4 md:px-0">
        <div className="max-w-xl w-full mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-8 text-center text-gray-900">Contact Us</h2>
          <form className="max-w-lg mx-auto grid gap-4 bg-white/95 shadow-xl rounded-2xl p-10 border border-sky-100">
            <input type="text" placeholder="Your Name" className="border border-sky-200 p-3 rounded-lg outline-sky-400 bg-sky-50" />
            <input type="email" placeholder="Your Email" className="border border-sky-200 p-3 rounded-lg outline-sky-400 bg-sky-50" />
            <textarea placeholder="Your Message" className="border border-sky-200 p-3 rounded-lg outline-sky-400 min-h-[100px] bg-sky-50" />
            <Button className="mt-2 bg-sky-600 hover:bg-sky-700 text-white">Send Message</Button>
          </form>
          <div className="text-center text-gray-500 mt-6">
            Or email us at <a href="mailto:info@godavaii.com" className="text-sky-600 underline">info@godavaii.com</a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-8 text-center text-gray-400 text-base border-t bg-white/90 shadow-inner mt-10">
        &copy; {year} GoDavaii. All rights reserved.
      </footer>
    </div>
  );
}

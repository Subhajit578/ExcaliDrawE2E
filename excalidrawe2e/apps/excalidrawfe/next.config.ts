import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge sits over the canvas in the bottom-left corner,
  // exactly where the board is drawn. It only ever appears in development -
  // compile and runtime errors are still reported without it.
  devIndicators: false,
};

export default nextConfig;

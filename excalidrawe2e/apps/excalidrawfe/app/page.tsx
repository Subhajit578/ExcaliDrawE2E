import React from 'react';
import Link from 'next/link'
import { 
  Pen, 
  Users, 
  Shield, 
  Download, 
  Zap, 
  Heart,
  Github,
  Twitter,
  ArrowRight,
  CheckCircle,
  Palette,
  MousePointer,
  Share2
} from 'lucide-react';

function App() {
  const features = [
    {
      icon: <Pen className="w-8 h-8" />,
      title: "Hand-drawn Style",
      description: "Create beautiful diagrams with a unique hand-drawn aesthetic that feels natural and engaging."
    },
    {
      icon: <Users className="w-8 h-8" />,
      title: "Real-time Collaboration",
      description: "Work together with your team in real-time. See cursors, changes, and collaborate seamlessly."
    },
    {
      icon: <Shield className="w-8 h-8" />,
      title: "Privacy First",
      description: "Your data stays local. No account required, no tracking, complete privacy by design."
    },
    {
      icon: <Download className="w-8 h-8" />,
      title: "Export Anywhere",
      description: "Export to PNG, SVG, or clipboard. Share your creations in any format you need."
    },
    {
      icon: <Zap className="w-8 h-8" />,
      title: "Lightning Fast",
      description: "Instant startup, smooth performance, and responsive drawing experience."
    },
    {
      icon: <Heart className="w-8 h-8" />,
      title: "Open Source",
      description: "Free forever, community-driven, and constantly improving with your feedback."
    }
  ];

  const useCases = [
    "Brainstorming sessions",
    "System architecture diagrams", 
    "User flow wireframes",
    "Mind mapping",
    "Educational illustrations",
    "Project planning"
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Pen className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">ExcaliDraw</span>
            </div>
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-gray-600 hover:text-gray-900 transition-colors">Features</a>
              <a href="#about" className="text-gray-600 hover:text-gray-900 transition-colors">About</a>
              <Link href = {"/signin"}>
              <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-all duration-200 transform hover:scale-105">
                Sign In
              </button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="mb-8">
              <div className="inline-flex items-center px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-medium mb-6">
                <Zap className="w-4 h-4 mr-2" />
                Free & Open Source
              </div>
              <h1 className="text-5xl md:text-7xl font-bold text-gray-900 mb-6 leading-tight">
                Virtual whiteboard for
                <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent"> sketching</span>
              </h1>
              <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
                Create beautiful hand-drawn style diagrams, wireframes, and illustrations. 
                Collaborate in real-time with complete privacy and zero setup required.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
              <Link href = {"./signup"}>
              <button className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-lg text-lg font-semibold transition-all duration-200 transform hover:scale-105 flex items-center justify-center">
                Sign Up
                <ArrowRight className="w-5 h-5 ml-2" />
              </button>
              </Link>
              <button className="border border-gray-300 hover:border-gray-400 text-gray-700 px-8 py-4 rounded-lg text-lg font-semibold transition-all duration-200 flex items-center justify-center">
                <Github className="w-5 h-5 mr-2" />
                View on GitHub
              </button>
            </div>

            {/* Demo Preview */}
            <div className="relative max-w-4xl mx-auto">
              <div className="bg-gradient-to-r from-blue-100 to-purple-100 rounded-2xl p-8 border-2 border-dashed border-blue-300">
                <div className="bg-white rounded-xl p-6 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <Palette className="w-5 h-5 text-gray-400" />
                      <MousePointer className="w-5 h-5 text-gray-400" />
                      <Share2 className="w-5 h-5 text-gray-400" />
                    </div>
                  </div>
                  <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
                    <div className="text-center">
                      <Pen className="w-16 h-16 text-blue-400 mx-auto mb-4" />
                      <p className="text-gray-500 text-lg">Your creative canvas awaits</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Everything you need to create
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Powerful features wrapped in a simple, intuitive interface that gets out of your way
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="bg-white rounded-xl p-8 shadow-sm hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1">
                <div className="text-blue-600 mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  {feature.title}
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl font-bold text-gray-900 mb-6">
                Perfect for every workflow
              </h2>
              <p className="text-xl text-gray-600 mb-8 leading-relaxed">
                Whether you're a designer, developer, educator, or entrepreneur, 
                ExcaliDraw adapts to your creative process.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {useCases.map((useCase, index) => (
                  <div key={index} className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-gray-700">{useCase}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl p-8">
              <div className="bg-white rounded-xl p-6 shadow-lg">
                <div className="space-y-4">
                  <div className="h-4 bg-blue-200 rounded w-3/4"></div>
                  <div className="h-4 bg-purple-200 rounded w-1/2"></div>
                  <div className="flex space-x-4">
                    <div className="w-16 h-16 bg-yellow-200 rounded-lg"></div>
                    <div className="w-16 h-16 bg-green-200 rounded-lg"></div>
                    <div className="w-16 h-16 bg-red-200 rounded-lg"></div>
                  </div>
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-purple-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Start creating today
          </h2>
          <p className="text-xl text-blue-100 mb-8 leading-relaxed">
            No sign-up required. No installations. Just open and start drawing.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button className="bg-white text-blue-600 px-8 py-4 rounded-lg text-lg font-semibold hover:bg-gray-50 transition-all duration-200 transform hover:scale-105">
              Launch ExcaliDraw
            </button>
            <button className="border border-white text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-white/10 transition-all duration-200">
              Learn More
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <Pen className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold">ExcaliDraw</span>
              </div>
              <p className="text-gray-400 leading-relaxed max-w-md">
                The open-source virtual whiteboard for sketching hand-drawn like diagrams. 
                Create, collaborate, and share with complete privacy.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Product</h3>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Roadmap</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Changelog</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Community</h3>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors flex items-center">
                  <Github className="w-4 h-4 mr-2" />
                  GitHub
                </a></li>
                <li><a href="#" className="hover:text-white transition-colors flex items-center">
                  <Twitter className="w-4 h-4 mr-2" />
                  Twitter
                </a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
            <p>&copy; 2025 ExcaliDraw. Open source and free forever.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
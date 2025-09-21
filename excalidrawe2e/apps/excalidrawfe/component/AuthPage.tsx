"use client"
import React, { useState } from 'react';
import { Eye, EyeOff, Mail, Lock, Sparkles } from 'lucide-react';
import axios from 'axios'
export function AuthPage({ isSignin }: { isSignin: boolean }) {
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState(""); // shown only on signup
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    async function signIn() {
        const res = await axios.post("http://localhost:3001/signin",{
            email,password
        })
        const { token } =  res.data
        localStorage.setItem("token",token);
    }
    async function signUp() {
        await axios.post("http://localhost:3001/signup",{
            email,username,password
        })
        
    }
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setErrorMsg(null);
        setSuccessMsg(null);
        try {
          if (isSignin) {
            await signIn();
            setSuccessMsg("Signed in successfully.");
          } else {
            await signUp();
            setSuccessMsg("Account created successfully.");
          }
          // TODO: navigate to dashboard, etc.
        } catch (err: any) {
          setErrorMsg(err?.message ?? "Something went wrong");
        } finally {
          setIsLoading(false);
        }
      };

      return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl mb-4 shadow-lg">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {isSignin ? "Welcome back" : "Create account"}
              </h1>
              <p className="text-gray-600">
                {isSignin
                  ? "Sign in to your account to continue"
                  : "Join us and start creating amazing things"}
              </p>
            </div>
    
            {/* Form */}
            
            <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl border border-gray-100 p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Email */}
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium text-gray-700">
                    Email address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors duration-200 bg-gray-50/50 backdrop-blur-sm"
                      required
                    />
                  </div>
                </div>
    
                {/* Username (only for signup) */}
                {!isSignin && (
                  <div className="space-y-2">
                    <label htmlFor="username" className="text-sm font-medium text-gray-700">
                      Username
                    </label>
                    <div className="relative">
                      <input
                        id="username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Choose a username"
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors duration-200 bg-gray-50/50 backdrop-blur-sm"
                        required
                      />
                    </div>
                  </div>
                )}
    
                {/* Password */}
                <div className="space-y-2">
                  <label htmlFor="password" className="text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Lock className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full pl-12 pr-12 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors duration-200 bg-gray-50/50 backdrop-blur-sm"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
    
                {/* Submit */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-4 rounded-xl font-medium hover:from-indigo-700 hover:to-purple-700 focus:ring-4 focus:ring-indigo-200 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-indigo-700 to-purple-700 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                  <span className="relative flex items-center justify-center">
                    {isLoading ? (
                      <div className="flex items-center space-x-2">
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Processing...</span>
                      </div>
                    ) : isSignin ? (
                      "Sign in"
                    ) : (
                      "Create account"
                    )}
                  </span>
                </button>
              </form>
    
              {/* Messages */}
              {errorMsg && (
                <p className="mt-4 text-sm text-red-600" role="alert">
                  {errorMsg}
                </p>
              )}
              {successMsg && (
                <p className="mt-4 text-sm text-green-600" role="status">
                  {successMsg}
                </p>
              )}
    
              {/* Divider */}
              <div className="mt-8">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-4 bg-white/80 text-gray-500">
                      {isSignin ? "Don't have an account?" : "Already have an account?"}
                    </span>
                  </div>
                </div>
              </div>
    
              {/* Switch Mode Button (wire to your router later) */}
              <div className="mt-6 text-center">
                <button type="button" className="text-indigo-600 hover:text-indigo-700 font-medium transition-colors">
                  {isSignin ? "Create a new account" : "Sign in instead"}
                </button>
              </div>
            </div>
    
            {/* Terms (only for sign up) */}
            {!isSignin && (
              <p className="mt-6 text-center text-sm text-gray-500">
                By creating an account, you agree to our{" "}
                <a href="#" className="text-indigo-600 hover:text-indigo-700 transition-colors">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="#" className="text-indigo-600 hover:text-indigo-700 transition-colors">
                  Privacy Policy
                </a>
              </p>
            )}
          </div>
        </div>
      );
    }
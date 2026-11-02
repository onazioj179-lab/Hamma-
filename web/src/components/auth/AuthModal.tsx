/**
 * HAMMA - Professional Authentication Modal
 * Native iOS/Android-style design
 */

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, User, Key, Eye, EyeOff, Copy, Check, AlertCircle, Shield, Loader2 } from 'lucide-react';
import { useAccountStore } from '@/store/account';

interface AuthModalProps {
  mode: 'login' | 'create' | 'recover';
  onClose: () => void;
  onSuccess?: () => void;
}

export function AuthModal({ mode: initialMode, onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountId, setAccountId] = useState('');
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const { createAccount, login, recoverAccount } = useAccountStore();
  
  const validatePassword = useCallback((pwd: string) => {
    if (pwd.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(pwd)) return 'Must include uppercase letter';
    if (!/[a-z]/.test(pwd)) return 'Must include lowercase letter';
    if (!/[0-9]/.test(pwd)) return 'Must include a number';
    return null;
  }, []);

  const passwordStrength = useMemo(() => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    return strength;
  }, [password]);
  
  const handleCreate = useCallback(async () => {
    setError('');
    
    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }
    
    const pwdError = validatePassword(password);
    if (pwdError) {
      setError(pwdError);
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    setLoading(true);
    const result = await createAccount(displayName.trim(), password);
    setLoading(false);
    
    if (result.success) {
      onSuccess?.();
    } else {
      setError(result.error || 'Failed to create account');
    }
  }, [displayName, password, confirmPassword, createAccount, validatePassword, onSuccess]);
  
  const handleLogin = useCallback(async () => {
    setError('');
    
    if (!accountId.trim()) {
      setError('Account ID is required');
      return;
    }
    
    if (!password) {
      setError('Password is required');
      return;
    }
    
    setLoading(true);
    const result = await login(accountId.trim(), password);
    setLoading(false);
    
    if (result.success) {
      onSuccess?.();
      onClose();
    } else {
      setError(result.error || 'Invalid credentials');
    }
  }, [accountId, password, login, onSuccess, onClose]);
  
  const handleRecover = useCallback(async () => {
    setError('');
    
    const words = recoveryPhrase.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      setError('Recovery phrase must be 12 or 24 words');
      return;
    }
    
    const pwdError = validatePassword(password);
    if (pwdError) {
      setError(pwdError);
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    setLoading(true);
    const result = await recoverAccount(recoveryPhrase.trim(), password);
    setLoading(false);
    
    if (result.success) {
      onSuccess?.();
      onClose();
    } else {
      setError(result.error || 'Invalid recovery phrase');
    }
  }, [recoveryPhrase, password, confirmPassword, recoverAccount, validatePassword, onSuccess, onClose]);
  
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'create') handleCreate();
    else if (mode === 'login') handleLogin();
    else handleRecover();
  }, [mode, handleCreate, handleLogin, handleRecover]);

  const titles = {
    create: { title: 'Create Account', subtitle: 'Get started with HAMMA' },
    login: { title: 'Welcome Back', subtitle: 'Sign in to your account' },
    recover: { title: 'Recover Account', subtitle: 'Use your recovery phrase' },
  };

  const { title, subtitle } = titles[mode];
  
  return (
    <motion.div 
      className="ios-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div 
        className="ios-modal"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="ios-modal-header relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-card-elevated"
            aria-label="Close modal"
          >
            <X className="w-5 h-5 text-muted" />
          </button>
          
          <motion.div 
            className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 
                       flex items-center justify-center shadow-lg"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.1 }}
          >
            {mode === 'create' && <User className="w-8 h-8 text-white" />}
            {mode === 'login' && <Lock className="w-8 h-8 text-white" />}
            {mode === 'recover' && <Key className="w-8 h-8 text-white" />}
          </motion.div>
          
          <h2 className="text-xl font-bold text-foreground">{title}</h2>
          <p className="text-sm text-muted mt-1">{subtitle}</p>
        </div>
        
        {/* Form */}
        <form onSubmit={handleSubmit} className="ios-modal-body space-y-4">
          {/* Error Message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 p-3 rounded-xl bg-danger/10"
              >
                <AlertCircle className="w-5 h-5 text-danger flex-shrink-0" />
                <span className="text-sm text-danger">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Create Account Fields */}
          {mode === 'create' && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="ios-input"
                  placeholder="Your name"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="ios-input pr-12"
                    placeholder="Create strong password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {/* Password Strength */}
                {password && (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            i <= passwordStrength
                              ? passwordStrength <= 2 ? 'bg-danger' 
                                : passwordStrength <= 4 ? 'bg-warning' 
                                : 'bg-success'
                              : 'bg-card-elevated'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-muted mt-1">
                      {passwordStrength <= 2 && 'Weak'}
                      {passwordStrength > 2 && passwordStrength <= 4 && 'Medium'}
                      {passwordStrength > 4 && 'Strong'}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="ios-input"
                  placeholder="Confirm your password"
                />
              </div>
            </>
          )}
          
          {/* Login Fields */}
          {mode === 'login' && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Account ID</label>
                <input
                  type="text"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="ios-input"
                  placeholder="Enter your account ID"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="ios-input pr-12"
                    placeholder="Enter password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </>
          )}
          
          {/* Recover Fields */}
          {mode === 'recover' && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Recovery Phrase</label>
                <textarea
                  value={recoveryPhrase}
                  onChange={(e) => setRecoveryPhrase(e.target.value)}
                  className="ios-input min-h-[100px] resize-none"
                  placeholder="Enter your 12-word recovery phrase"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">New Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="ios-input"
                  placeholder="Create new password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="ios-input"
                  placeholder="Confirm new password"
                />
              </div>
            </>
          )}
          
          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className={`ios-btn w-full mt-6 ${mode === 'create' ? 'ios-btn-success' : 'ios-btn-primary'}`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </span>
            ) : (
              <>
                {mode === 'create' && 'Create Account'}
                {mode === 'login' && 'Sign In'}
                {mode === 'recover' && 'Recover Account'}
              </>
            )}
          </button>
        </form>
        
        {/* Footer Links */}
        <div className="ios-modal-footer justify-center">
          {mode === 'login' && (
            <>
              <button
                type="button"
                onClick={() => setMode('create')}
                className="text-sm text-accent font-medium"
              >
                Create Account
              </button>
              <span className="text-muted">•</span>
              <button
                type="button"
                onClick={() => setMode('recover')}
                className="text-sm text-accent font-medium"
              >
                Forgot Password?
              </button>
            </>
          )}
          {mode === 'create' && (
            <button
              type="button"
              onClick={() => setMode('login')}
              className="text-sm text-accent font-medium"
            >
              Already have an account? Sign In
            </button>
          )}
          {mode === 'recover' && (
            <button
              type="button"
              onClick={() => setMode('login')}
              className="text-sm text-accent font-medium"
            >
              Back to Login
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// Recovery Phrase Modal - shown after account creation
interface RecoveryPhraseModalProps {
  phrase: string[];
  onConfirm: () => void;
}

export function RecoveryPhraseModal({ phrase, onConfirm }: RecoveryPhraseModalProps) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(phrase.join(' '));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [phrase]);
  
  return (
    <motion.div 
      className="ios-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div 
        className="ios-modal max-w-lg"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="ios-modal-header">
          <motion.div 
            className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-yellow-500 to-orange-600 
                       flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.1 }}
          >
            <Shield className="w-8 h-8 text-white" />
          </motion.div>
          
          <h2 className="text-xl font-bold text-foreground">Save Your Recovery Phrase</h2>
          <p className="text-sm text-muted mt-1">
            This is the ONLY way to recover your account if you forget your password.
          </p>
        </div>
        
        {/* Phrase Grid */}
        <div className="ios-modal-body">
          <div className="p-4 rounded-2xl bg-warning/5 border border-warning/20 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-warning" />
              <span className="text-sm font-semibold text-warning">Important</span>
            </div>
            <p className="text-xs text-muted">
              Write these words down in order and store them in a safe place. 
              Never share them with anyone. HAMMA cannot recover this phrase for you.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {phrase.map((word, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="flex items-center gap-2 p-3 rounded-xl bg-card-elevated"
              >
                <span className="w-6 h-6 flex items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">
                  {index + 1}
                </span>
                <span className="text-sm font-medium text-foreground">{word}</span>
              </motion.div>
            ))}
          </div>
          
          <button
            onClick={handleCopy}
            className="w-full ios-btn-secondary flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check className="w-5 h-5 text-success" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-5 h-5" />
                Copy to Clipboard
              </>
            )}
          </button>
          
          {/* Confirmation Checkbox */}
          <label className="flex items-start gap-3 mt-6 cursor-pointer">
            <div className="mt-0.5">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="sr-only"
              />
              <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors ${
                confirmed ? 'bg-success border-success' : 'border-muted'
              }`}>
                {confirmed && <Check className="w-4 h-4 text-white" />}
              </div>
            </div>
            <span className="text-sm text-muted">
              I have written down my recovery phrase and stored it in a safe place.
              I understand that HAMMA cannot recover this for me.
            </span>
          </label>
        </div>
        
        {/* Footer */}
        <div className="ios-modal-footer">
          <button
            onClick={onConfirm}
            disabled={!confirmed}
            className={`ios-btn flex-1 ${confirmed ? 'ios-btn-success' : 'ios-btn-secondary opacity-50'}`}
          >
            I've Saved My Phrase
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

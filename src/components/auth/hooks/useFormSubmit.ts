import { useState } from 'react';

export function useFormSubmit() {
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setErrorMessage('');
    setIsSubmitting(false);
  };

  return { errorMessage, setErrorMessage, isSubmitting, setIsSubmitting, reset };
}

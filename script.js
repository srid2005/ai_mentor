/**
 * AI Virtual Interviewer - Client Application Logic
 * Integrates Web Speech API (STT & TTS), file upload resume parsing,
 * and conversational turn handling via FastAPI and Gemini API.
 */

(function () {
  'use strict';

  // Determine speech recognition interface
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Configuration
  const API_BASE_URL = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
    ? window.location.origin
    : 'http://127.0.0.1:8000';

  // State Variables
  let recognition = null;
  let isRecording = false;
  let micPermissionState = 'prompt';
  let accumulatedFinalText = '';
  let currentSessionFinalText = '';
  let autoRestartTimeoutId = null;

  let sessionId = null;
  let parsedResumeData = null;
  let interviewConversation = []; // list of {role, content}

  // DOM Elements mapping
  const elements = {
    cardContainer: document.getElementById('cardContainer'),
    errorBanner: document.getElementById('errorBanner'),
    errorMessage: document.getElementById('errorMessage'),
    closeErrorBtn: document.getElementById('closeErrorBtn'),
    unsupportedOverlay: document.getElementById('unsupportedOverlay'),
    
    // Step 1
    uploadZone: document.getElementById('uploadZone'),
    resumeFileInput: document.getElementById('resumeFileInput'),
    parseLoader: document.getElementById('parseLoader'),
    resumePreviewCard: document.getElementById('resumePreviewCard'),
    btnStartInterview: document.getElementById('btnStartInterview'),
    
    candName: document.getElementById('candName'),
    candEmail: document.getElementById('candEmail'),
    candPhone: document.getElementById('candPhone'),
    candLinkedin: document.getElementById('candLinkedin'),
    candGithub: document.getElementById('candGithub'),
    candPortfolio: document.getElementById('candPortfolio'),
    candSkills: document.getElementById('candSkills'),

    // Step 2
    micStatusText: document.getElementById('micStatusText'),
    interviewerStatusText: document.getElementById('interviewerStatusText'),
    listeningStatusText: document.getElementById('listeningStatusText'),
    
    micStatusItem: document.getElementById('micStatusItem'),
    interviewerStatusItem: document.getElementById('interviewerStatusItem'),
    listeningStatusItem: document.getElementById('listeningStatusItem'),
    
    chatArena: document.getElementById('chatArena'),
    
    visualizerContainer: document.getElementById('visualizerContainer'),
    micInteractionBtn: document.getElementById('micInteractionBtn'),
    
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    clearBtn: document.getElementById('clearBtn'),
    ttsToggle: document.getElementById('ttsToggle'),
    
    candidateResponseText: document.getElementById('candidateResponseText'),
    btnSubmitAnswer: document.getElementById('btnSubmitAnswer'),
    btnFinishEarly: document.getElementById('btnFinishEarly'),

    // Step 3
    finalTranscriptLog: document.getElementById('finalTranscriptLog'),
    btnRestart: document.getElementById('btnRestart')
  };

  /**
   * Initializes the application wizard and checks speech recognition support.
   */
  function init() {
    // Warm up speech synthesis voices list
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
      }
    }

    if (!SpeechRecognition) {
      showUnsupportedBrowser();
      return;
    }

    setupSpeechRecognition();
    setupEventListeners();
    updateUIState();
  }

  /**
   * Shows the unsupported browser overlay.
   */
  function showUnsupportedBrowser() {
    elements.unsupportedOverlay.classList.add('show');
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = true;
    elements.clearBtn.disabled = true;
    elements.btnStartInterview.disabled = true;
    updateStatusItem(elements.micStatusItem, elements.micStatusText, 'Unsupported', 'error');
    updateStatusItem(elements.listeningStatusItem, elements.listeningStatusText, 'Unsupported', 'error');
  }

  /**
   * Instantiates and configures the Web Speech API recognition service.
   */
  function setupSpeechRecognition() {
    recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    if ('unspokenPunctuation' in recognition) {
      recognition.unspokenPunctuation = true;
    }

    recognition.onstart = handleRecognitionStart;
    recognition.onresult = handleRecognitionResult;
    recognition.onerror = handleRecognitionError;
    recognition.onend = handleRecognitionEnd;
    
    recognition.onspeechstart = handleSpeechStart;
    recognition.onspeechend = handleSpeechEnd;
  }

  /**
   * Sets up event listeners for steps, file upload, buttons.
   */
  function setupEventListeners() {
    // Step 1: Upload
    elements.uploadZone.addEventListener('click', () => elements.resumeFileInput.click());
    
    elements.uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      elements.uploadZone.classList.add('dragover');
    });
    
    elements.uploadZone.addEventListener('dragleave', () => {
      elements.uploadZone.classList.remove('dragover');
    });
    
    elements.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      elements.uploadZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFileSelection(e.dataTransfer.files[0]);
      }
    });
    
    elements.resumeFileInput.addEventListener('change', () => {
      if (elements.resumeFileInput.files.length > 0) {
        handleFileSelection(elements.resumeFileInput.files[0]);
      }
    });

    elements.btnStartInterview.addEventListener('click', startInterviewSession);

    // Step 2: Controls
    elements.startBtn.addEventListener('click', startRecording);
    elements.stopBtn.addEventListener('click', stopRecording);
    elements.clearBtn.addEventListener('click', clearTranscripts);
    
    elements.micInteractionBtn.addEventListener('click', toggleRecording);
    elements.closeErrorBtn.addEventListener('click', dismissError);

    elements.candidateResponseText.addEventListener('input', () => {
      accumulatedFinalText = elements.candidateResponseText.value;
      currentSessionFinalText = '';
      elements.btnSubmitAnswer.disabled = elements.candidateResponseText.value.trim() === '';
    });

    elements.btnSubmitAnswer.addEventListener('click', submitCandidateAnswer);
    elements.btnFinishEarly.addEventListener('click', endInterview);

    // Step 3: Restart
    elements.btnRestart.addEventListener('click', restartSession);
  }

  /* ==========================================
     STEP 1 LOGIC: RESUME UPLOAD & PARSING
     ========================================== */

  function handleFileSelection(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showError('Only PDF files are allowed.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showError('File size exceeds the 10 MB limit.');
      return;
    }
    
    dismissError();
    elements.parseLoader.classList.remove('hidden');
    elements.uploadZone.classList.add('hidden');
    elements.resumePreviewCard.classList.add('hidden');
    
    const formData = new FormData();
    formData.append('resume', file);
    
    fetch(`${API_BASE_URL}/parse`, {
      method: 'POST',
      body: formData
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.detail || 'Failed to parse resume');
        });
      }
      return response.json();
    })
    .then(result => {
      elements.parseLoader.classList.add('hidden');
      if (result.success) {
        displayResumePreview(result.data);
      } else {
        throw new Error(result.message || 'Parsing failed');
      }
    })
    .catch(err => {
      console.error(err);
      elements.parseLoader.classList.add('hidden');
      elements.uploadZone.classList.remove('hidden');
      showError(err.message || 'An error occurred during resume parsing.');
    });
  }

  function displayResumePreview(data) {
    parsedResumeData = data;
    
    elements.candName.textContent = data.name || 'Not found';
    elements.candEmail.textContent = data.email || 'Not found';
    elements.candPhone.textContent = data.phone || 'Not found';
    elements.candLinkedin.textContent = data.linkedin || 'Not found';
    elements.candGithub.textContent = data.github || 'Not found';
    elements.candPortfolio.textContent = data.portfolio || 'Not found';
    
    elements.candSkills.innerHTML = '';
    if (data.skills && data.skills.length > 0) {
      data.skills.forEach(skill => {
        const tag = document.createElement('span');
        tag.className = 'skills-tag';
        tag.textContent = skill;
        elements.candSkills.appendChild(tag);
      });
    } else {
      elements.candSkills.innerHTML = '<span class="placeholder-text" style="font-style: normal;">No skills detected</span>';
    }
    
    elements.resumePreviewCard.classList.remove('hidden');
  }

  function startInterviewSession() {
    if (!parsedResumeData) return;
    
    elements.btnStartInterview.disabled = true;
    elements.btnStartInterview.textContent = '⏱️ Setting up session...';
    
    fetch(`${API_BASE_URL}/interview/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ resume_data: parsedResumeData })
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to start interview session.');
      }
      return response.json();
    })
    .then(result => {
      sessionId = result.session_id;
      interviewConversation = [];
      
      // Clear chat
      elements.chatArena.innerHTML = '';
      
      // Welcome question
      appendMessage('interviewer', result.question);
      
      // Move to room
      transitionToStep(2);
      
      // Speak welcome
      speakQuestionText(result.question);
    })
    .catch(err => {
      console.error(err);
      showError(err.message || 'Error entering interview room.');
      elements.btnStartInterview.disabled = false;
      elements.btnStartInterview.textContent = '🚀 Enter Interview Room & Start';
    });
  }

  /* ==========================================
     STEP 2 LOGIC: INTERVIEW & TURN HANDLING
     ========================================== */

  function appendMessage(role, content) {
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${role}`;
    bubble.textContent = content;
    elements.chatArena.appendChild(bubble);
    elements.chatArena.scrollTop = elements.chatArena.scrollHeight;
    
    interviewConversation.push({ role, content });
  }

  function showTypingIndicator() {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble typing';
    bubble.id = 'typingBubble';
    bubble.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;
    elements.chatArena.appendChild(bubble);
    elements.chatArena.scrollTop = elements.chatArena.scrollHeight;
    
    updateStatusItem(elements.interviewerStatusItem, elements.interviewerStatusText, 'Thinking...', 'warning');
  }

  function removeTypingIndicator() {
    const bubble = document.getElementById('typingBubble');
    if (bubble) bubble.remove();
    
    updateStatusItem(elements.interviewerStatusItem, elements.interviewerStatusText, 'Ready', 'active');
  }

  function submitCandidateAnswer() {
    const responseText = elements.candidateResponseText.value.trim();
    if (!responseText || !sessionId) return;
    
    if (isRecording) {
      stopRecording();
    }
    
    appendMessage('candidate', responseText);
    
    elements.candidateResponseText.value = '';
    elements.btnSubmitAnswer.disabled = true;
    accumulatedFinalText = '';
    currentSessionFinalText = '';
    
    showTypingIndicator();
    
    fetch(`${API_BASE_URL}/interview/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: sessionId,
        response: responseText
      })
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Server connection failed.');
      }
      return response.json();
    })
    .then(result => {
      removeTypingIndicator();
      appendMessage('interviewer', result.question);
      speakQuestionText(result.question);
      
      if (result.ended) {
        setTimeout(() => {
          endInterview();
        }, 5000);
      }
    })
    .catch(err => {
      console.error(err);
      removeTypingIndicator();
      showError(err.message || 'Failed to submit response.');
    });
  }

  /* ==========================================
     TEXT TO SPEECH (TTS)
     ========================================== */

  function speakQuestionText(text) {
    if (!elements.ttsToggle.checked || !window.speechSynthesis) return;
    
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    // Prefer clean English voices
    const selectedVoice = voices.find(voice => voice.lang.startsWith('en-') && voice.name.toLowerCase().includes('natural')) 
                    || voices.find(voice => voice.lang.startsWith('en-') && voice.name.toLowerCase().includes('google'))
                    || voices.find(voice => voice.lang.startsWith('en-'));
                    
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    
    utterance.onstart = () => {
      updateStatusItem(elements.interviewerStatusItem, elements.interviewerStatusText, 'Speaking...', 'listening');
    };
    
    utterance.onend = () => {
      updateStatusItem(elements.interviewerStatusItem, elements.interviewerStatusText, 'Listening', 'active');
    };
    
    utterance.onerror = (e) => {
      console.error('Speech synthesis error:', e);
      updateStatusItem(elements.interviewerStatusItem, elements.interviewerStatusText, 'Ready', 'active');
    };
    
    window.speechSynthesis.speak(utterance);
  }

  /* ==========================================
     RECOGNITION EVENT HANDLERS (STT)
     ========================================== */

  function handleRecognitionStart() {
    console.log('SpeechRecognition: Started listening...');
    micPermissionState = 'granted';
    
    updateStatusItem(elements.micStatusItem, elements.micStatusText, 'Allowed', 'active');
    updateStatusItem(elements.listeningStatusItem, elements.listeningStatusText, 'Listening...', 'listening');
    
    elements.visualizerContainer.classList.add('recording');
    updateUIState();
  }

  function handleRecognitionResult(event) {
    let interimText = '';
    currentSessionFinalText = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const result = event.results[i];
      if (result.isFinal) {
        currentSessionFinalText += result[0].transcript + ' ';
      } else {
        interimText += result[0].transcript;
      }
    }

    let sessionFinalText = '';
    for (let i = 0; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        sessionFinalText += event.results[i][0].transcript + ' ';
      }
    }
    currentSessionFinalText = sessionFinalText;

    const fullText = (accumulatedFinalText + currentSessionFinalText).trim();
    
    if (fullText || interimText) {
      const displayString = capitalizeAndPunctuate(fullText + (interimText ? ' ' + interimText : ''));
      elements.candidateResponseText.value = displayString;
      elements.btnSubmitAnswer.disabled = displayString.trim() === '';
    }
  }

  function handleRecognitionError(event) {
    console.error('SpeechRecognition Error:', event.error);
    let userMessage = 'Speech recognition encountered an issue.';
    let isFatal = false;

    switch (event.error) {
      case 'not-allowed':
        micPermissionState = 'denied';
        userMessage = 'Microphone permission denied. Please allow access in browser settings.';
        isFatal = true;
        updateStatusItem(elements.micStatusItem, elements.micStatusText, 'Permission Denied', 'error');
        break;
      case 'audio-capture':
        userMessage = 'No microphone detected.';
        isFatal = true;
        updateStatusItem(elements.micStatusItem, elements.micStatusText, 'Mic Error', 'error');
        break;
      case 'no-speech':
        userMessage = 'No speech detected.';
        isFatal = false;
        break;
      case 'network':
        userMessage = 'Network error occurred during STT.';
        isFatal = false;
        break;
      case 'aborted':
        isFatal = true;
        break;
    }

    showError(userMessage);

    if (isFatal) {
      isRecording = false;
      cleanupVisualStates();
      updateStatusItem(elements.listeningStatusItem, elements.listeningStatusText, 'Stopped (Error)', 'error');
      updateUIState();
    }
  }

  function handleRecognitionEnd() {
    console.log('SpeechRecognition: Connection ended.');

    if (currentSessionFinalText) {
      accumulatedFinalText += currentSessionFinalText;
      currentSessionFinalText = '';
    }

    if (isRecording) {
      autoRestartTimeoutId = setTimeout(() => {
        if (isRecording) {
          try {
            recognition.start();
          } catch (e) {
            console.error('Failed to restart STT:', e);
          }
        }
      }, 300);
    } else {
      cleanupVisualStates();
      updateStatusItem(elements.listeningStatusItem, elements.listeningStatusText, 'Stopped', 'idle');
      updateUIState();
    }
  }

  function handleSpeechStart() {
    if (isRecording) {
      elements.visualizerContainer.classList.add('speaking');
      updateStatusItem(elements.listeningStatusItem, elements.listeningStatusText, 'Speaking...', 'active');
    }
  }

  function handleSpeechEnd() {
    elements.visualizerContainer.classList.remove('speaking');
    if (isRecording) {
      updateStatusItem(elements.listeningStatusItem, elements.listeningStatusText, 'Listening...', 'listening');
    }
  }

  /* ==========================================
     STT CONTROLLER ACTIONS
     ========================================== */

  function startRecording() {
    if (isRecording) return;
    dismissError();

    isRecording = true;
    updateUIState();
    
    updateStatusItem(elements.listeningStatusItem, elements.listeningStatusText, 'Connecting...', 'warning');

    try {
      recognition.start();
    } catch (e) {
      console.error(e);
      showError('Failed to initialize microphone connection.');
      isRecording = false;
      cleanupVisualStates();
      updateUIState();
    }
  }

  function stopRecording() {
    if (!isRecording) return;

    isRecording = false;
    clearTimeout(autoRestartTimeoutId);
    
    updateStatusItem(elements.listeningStatusItem, elements.listeningStatusText, 'Stopping...', 'warning');

    try {
      recognition.stop();
    } catch (e) {
      console.error(e);
      cleanupVisualStates();
      updateUIState();
    }
  }

  function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  function clearTranscripts() {
    accumulatedFinalText = '';
    currentSessionFinalText = '';
    elements.candidateResponseText.value = '';
    elements.btnSubmitAnswer.disabled = true;
    
    if (isRecording) {
      try {
        recognition.stop();
      } catch (e) {}
    }
  }

  /* ==========================================
     STEP 3 LOGIC: END INTERVIEW & WRAP-UP
     ========================================== */

  function endInterview() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    
    if (isRecording) {
      isRecording = false;
      clearTimeout(autoRestartTimeoutId);
      try {
        recognition.stop();
      } catch (e) {}
    }
    
    elements.finalTranscriptLog.innerHTML = '';
    if (interviewConversation.length === 0) {
      elements.finalTranscriptLog.innerHTML = '<span class="placeholder-text" style="font-style:normal;">No conversation dialogue has been logged.</span>';
    } else {
      interviewConversation.forEach(turn => {
        const turnDiv = document.createElement('div');
        turnDiv.className = 'transcript-turn';
        
        const speakerSpan = document.createElement('span');
        speakerSpan.className = `turn-speaker ${turn.role}`;
        speakerSpan.textContent = turn.role === 'interviewer' ? 'AI Interviewer' : 'Candidate';
        
        const contentP = document.createElement('p');
        contentP.className = 'turn-content';
        contentP.textContent = turn.content;
        
        turnDiv.appendChild(speakerSpan);
        turnDiv.appendChild(contentP);
        elements.finalTranscriptLog.appendChild(turnDiv);
      });
    }
    
    transitionToStep(3);
  }

  function restartSession() {
    sessionId = null;
    parsedResumeData = null;
    interviewConversation = [];
    accumulatedFinalText = '';
    currentSessionFinalText = '';
    
    elements.btnStartInterview.disabled = false;
    elements.btnStartInterview.textContent = '🚀 Enter Interview Room & Start';
    
    elements.resumeFileInput.value = '';
    elements.resumePreviewCard.classList.add('hidden');
    elements.uploadZone.classList.remove('hidden');
    
    elements.candidateResponseText.value = '';
    elements.btnSubmitAnswer.disabled = true;
    
    transitionToStep(1);
  }

  /* ==========================================
     UI HELPERS
     ========================================== */

  function transitionToStep(stepNum) {
    const steps = ['stepUpload', 'stepInterview', 'stepWrapup'];
    
    steps.forEach((stepId, idx) => {
      const el = document.getElementById(stepId);
      if (idx === stepNum - 1) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });

    for (let i = 1; i <= 3; i++) {
      const item = document.getElementById(`progressStep${i}`);
      const line = document.getElementById(`progressLine${i - 1}`);
      
      if (i < stepNum) {
        item.className = 'step-progress-item completed';
        if (line) line.style.backgroundColor = 'var(--accent-success)';
      } else if (i === stepNum) {
        item.className = 'step-progress-item active';
        if (line) line.style.backgroundColor = 'var(--glass-border)';
      } else {
        item.className = 'step-progress-item';
        if (line) line.style.backgroundColor = 'var(--glass-border)';
      }
    }
  }

  function updateUIState() {
    elements.startBtn.disabled = isRecording;
    elements.stopBtn.disabled = !isRecording;
    
    if (isRecording) {
      elements.micInteractionBtn.setAttribute('title', 'Stop Recording');
    } else {
      elements.micInteractionBtn.setAttribute('title', 'Start Recording');
    }
  }

  function updateStatusItem(itemContainer, textSpan, text, stateClass) {
    if (!itemContainer || !textSpan) return;
    
    textSpan.textContent = text;
    itemContainer.className = 'status-item';
    
    switch (stateClass) {
      case 'active':
        itemContainer.classList.add('status-active');
        break;
      case 'listening':
        itemContainer.classList.add('status-listening');
        break;
      case 'error':
        itemContainer.classList.add('status-error');
        break;
      case 'warning':
        itemContainer.classList.add('status-warning');
        break;
      case 'idle':
      default:
        itemContainer.classList.add('status-idle');
    }
  }

  function cleanupVisualStates() {
    elements.visualizerContainer.className = 'visualizer-container';
  }

  function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorBanner.classList.add('show');
    elements.cardContainer.scrollTop = 0;
    
    if (!message.includes('permission') && !message.includes('microphone')) {
      setTimeout(dismissError, 7000);
    }
  }

  function dismissError() {
    elements.errorBanner.classList.remove('show');
  }

  function capitalizeAndPunctuate(text) {
    if (!text) return '';
    let formatted = text.replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
    formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    const trimmed = formatted.trim();
    if (trimmed && !/[.!?]$/.test(trimmed)) {
      formatted = trimmed + '.';
    }
    return formatted;
  }

  document.addEventListener('DOMContentLoaded', init);

})();

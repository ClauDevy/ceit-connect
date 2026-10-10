tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        paper: '#FFF8F0',
        card: '#FFFFFF',
        ink: '#1B140F',
        slate: { 100:'#F1ECE4', 300:'#DCD3C6', 500:'#8B8072', 700:'#5B5147' },
        council: { DEFAULT:'#EC6608', dark:'#A8440A', light:'#FFDDBB', wash:'#FFF1E2' },
        night: { bg:'#17120E', card:'#221B15', text:'#F3E9DD', muted:'#B7A997', wash:'#3A2013' },
      },
      fontFamily: {
        display: ['Fredoka','sans-serif'],
        body: ['"Plus Jakarta Sans"','sans-serif'],
      },
    }
  }
}

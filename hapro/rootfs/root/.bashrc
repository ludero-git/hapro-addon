# ~/.bashrc for Hapro Web Terminal

alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'

if [ ! -S /var/run/docker.sock ] && [ ! -S /run/docker.sock ]; then
  echo -e "\033[33m[Notice] /var/run/docker.sock is not mounted into this add-on container.\033[0m"
  echo -e "\033[33mTo use 'docker' commands in the web terminal, disable 'Protection mode' for the Hapro add-on in Home Assistant (Settings -> Add-ons -> Hapro -> Protection mode: OFF).\033[0m\n"
fi

# Home Assistant Add-on: HaPRO

![Supports aarch64 Architecture][aarch64-shield]
![Supports amd64 Architecture][amd64-shield]

![HaPRO Logo](https://api.ludero.nl/images/LogoDark.png)

<!-- ![Supports armhf Architecture][armhf-shield] -->
<!-- ![Supports armv7 Architecture][armv7-shield] -->
<!-- ![Supports i386 Architecture][i386-shield] -->
HaPRO extends the capabilities of your Home Assistant installation by providing an easy-to-use interface for creating public URLs, managing cloud backups, and handling multiple homes seamlessly.

## Quick Installation
[![Install the addon on your Home Assistant.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fludero-git%2Fhapro-addon)

## Features

### Public URL Creation

- **Secure Access Anywhere**: Generate secure, public URLs for your Home Assistant setup, allowing you to access your smart home from anywhere in the world.
- **Automatic SSL Management**: HaPRO handles SSL certificate generation and renewal to ensure your connections are always secure.

### Cloud Backups

<!-- - **Scheduled Backups**: Configure automatic backups on a daily, weekly, or monthly basis. -->
- **Offsite Storage**: Safeguard your configurations and data by storing backups in the cloud, protecting against local hardware failures.

### Multi-Home Management

- **Unified Dashboard**: Manage multiple Home Assistant installations from a single dashboard.
- **Custom Configurations**: Tailor settings for each home while maintaining overall control from one account.

## Getting Started

### Prerequisites

- Home Assistant installed and running on your local network.
- An active internet connection for setting up public URLs.

### Quick Installation
[![Install the addon on your Home Assistant.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fludero-git%2Fhapro-addon)

### Manual Installation

1. From the Home Assistant Add-On Store, navigate to the overflow menu in the top right corner and select "Repositories."
2. Add the following URL: [https://github.com/ludero-git/hapro-addon](https://github.com/ludero-git/hapro-addon)
3. Refresh the Add-On Store, and you should see the HaPro Repository with the HaPro add-on.
4. Click on the HaPro add-on, then click "Install."

### Configuration

-  Start the add-on after installation.
- Go to the portal and login with your HaPro account.
- Navigate to add a new device and paste the token from the add-on log.
- Continue the setup process, which includes giving your device a name and restarting the add-on.
- You should now see your device in the HaPro dashboard.

#### Advanced Configuration Options

- **`caddy_port`** (default: `8099`): The port Caddy uses for reverse proxying. Change this if you have port conflicts with other add-ons like Tailscale. The rathole tunnel will automatically connect to this port.

## Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

## License

See `LICENSE` for more information.

## Support

For support, email email@placeholder.com or open an issue on the GitHub project page.


[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg
[armhf-shield]: https://img.shields.io/badge/armhf-yes-green.svg
[armv7-shield]: https://img.shields.io/badge/armv7-yes-green.svg
[i386-shield]: https://img.shields.io/badge/i386-yes-green.svg

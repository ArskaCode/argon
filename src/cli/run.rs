use anyhow::Result;
use clap::Parser;
use colored::Colorize;
use log::trace;
use std::{
	env,
	path::PathBuf,
	process::{self, Command},
};

use crate::{
	argon_error, argon_info, argon_warn,
	config::Config,
	core::Core,
	program::{Program, ProgramKind},
	project::{self, Project},
	server::{self, Server},
	sessions, util, workspace,
};

/// Run Argon, start local server and looking for file changes
#[derive(Parser)]
pub struct Run {
	/// Server host name
	#[arg(short = 'H', long)]
	host: Option<String>,

	/// Server port
	#[arg(short = 'P', long)]
	port: Option<u16>,

	/// Project path
	#[arg()]
	project: Option<PathBuf>,

	/// Session indentifier
	#[arg()]
	session: Option<String>,

	/// Whether to run using roblox-ts
	#[arg(short, long)]
	ts: bool,

	/// Spawn the Argon child process
	#[arg(long, hide = true)]
	argon_spawn: bool,
}

impl Run {
	pub fn main(self) -> Result<()> {
		let config = Config::load();

		let project = self.project.clone().unwrap_or_default();
		let project_path = project::resolve(project.clone(), config.project_name())?;

		if !self.argon_spawn {
			let project_exists = project_path.exists();

			if !project_exists && config.auto_init() {
				argon_warn!("Cannot find the project, creating new one!");

				if self.ts {
					if !workspace::init_ts(&project, config.template(), config.use_git())? {
						return Ok(());
					}
				} else {
					workspace::init(
						&project_path,
						config.template(),
						config.source_dir(),
						config.use_git(),
						config.include_docs(),
					)?;

					if config.use_git() {
						let workspace_dir = workspace::get_dir(&project_path);

						workspace::initialize_repo(&workspace_dir)?;
					}
				}
			} else if !project_exists {
				argon_error!(
					"Project {} does not exist. Run {} or enable {} setting first.",
					project_path.to_str().unwrap().bold(),
					"argon init".bold(),
					"auto_init".bold()
				);

				return Ok(());
			}

			if config.spawn() {
				return self.spawn();
			}
		}

		if self.ts {
			trace!("Starting roblox-ts");

			let mut working_dir = project_path.clone();
			working_dir.pop();

			let child = Program::new(ProgramKind::Npx)
				.message("Failed to serve roblox-ts project")
				.current_dir(&working_dir)
				.arg("rbxtsc")
				.arg("--watch")
				.spawn()?;

			if let Some(mut child) = child {
				util::handle_kill(move || {
					child.kill().ok();
				})?;
			} else {
				return Ok(());
			}
		}

		let scan_ports = config.scan_ports();
		let project = Project::load(&project_path)?;
		let mut core = Core::new(config, project)?;

		let host = self.host.unwrap_or(core.host());
		let mut port = self.port.unwrap_or(core.port());

		if !server::is_port_free(&host, port) {
			if scan_ports {
				let new_port = server::get_free_port(&host, port);

				argon_warn!("Port {} is already in use, using {} instead!", port, new_port);

				port = new_port;
			} else {
				argon_error!(
					"Port {} is already in use! Enable {} setting to use first available port automatically.",
					port,
					"scan_ports".bold()
				);

				return Ok(());
			}
		}

		core.load_dom()?;

		let server = Server::new(core, &host, &port);

		sessions::add(self.session, Some(host.clone()), Some(port), process::id())?;

		argon_info!(
			"Running on: {}:{}, project: {}",
			host,
			port,
			project_path.to_str().unwrap()
		);

		server.start()?;

		Ok(())
	}

	fn spawn(self) -> Result<()> {
		let program = env::current_exe().unwrap_or(PathBuf::from("argon"));

		let log_style = env::var("RUST_LOG_STYLE").unwrap_or("auto".to_string());
		let backtrace = env::var("RUST_BACKTRACE").unwrap_or("0".to_string());

		let mut args = vec![String::from("run"), util::get_verbosity_flag()];

		if let Some(host) = self.host {
			args.push(String::from("--host"));
			args.push(host)
		}

		if let Some(port) = self.port {
			args.push(String::from("--port"));
			args.push(port.to_string());
		}

		if let Some(project) = self.project {
			args.push(project.to_str().unwrap().to_string());
		}

		if let Some(session) = self.session {
			args.push(session);
		}

		if self.ts {
			args.push(String::from("--ts"));
		}

		Command::new(program)
			.args(args)
			.arg("--yes")
			.arg("--argon-spawn")
			.env("RUST_LOG_STYLE", log_style)
			.env("RUST_BACKTRACE", backtrace)
			.spawn()?;

		Ok(())
	}
}

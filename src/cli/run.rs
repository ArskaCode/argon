use anyhow::{bail, Result};
use clap::{ArgAction, Parser};
use colored::Colorize;
use log::LevelFilter;
use std::{
	env,
	path::PathBuf,
	process::{self, Command},
};

use crate::{
	argon_error, argon_info, argon_warn,
	config::Config,
	core::Core,
	project::{self, Project},
	server::Server,
	sessions, workspace,
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

	/// Optional session indentifier
	#[arg()]
	session_id: Option<String>,

	/// Whether to run using roblox-ts
	#[arg(short, long, action = ArgAction::SetTrue)]
	ts: bool,

	/// Actually run Argon, used to spawn new process
	#[arg(short, long, action = ArgAction::SetTrue, hide = true)]
	run: bool,
}

impl Run {
	pub fn main(self, log_level: LevelFilter) -> Result<()> {
		let config = Config::load();

		let project = self.project.clone().unwrap_or_default();
		let project_path = project::resolve(project.clone(), &config.project_name)?;

		if !self.run {
			let project_exists = project_path.exists();

			if !project_exists && config.auto_init {
				argon_warn!("Cannot find the project, creating new one!");

				if self.ts {
					if !workspace::init_ts(&project)? {
						bail!("Failed to initialize roblox-ts project!")
					}
				} else {
					workspace::init(&project_path, &config.template, &config.source_dir)?;

					if config.git_init {
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

			return self.spawn(log_level);
		}

		if self.ts {
			println!("{:?}", project_path);
			// Command::new("npx").arg("rbxtsc").arg("--watch").spawn()?;
			// TODO: Implement
		}

		let project = Project::load(&project_path)?;
		let mut core = Core::new(config, project)?;

		let host = self.host.unwrap_or(core.host());
		let port = self.port.unwrap_or(core.port());

		core.load_dom()?;

		let server = Server::new(core, &host, &port);

		sessions::add(self.session_id, Some(host.clone()), Some(port), process::id())?;

		argon_info!(
			"Running on: {}:{}, project: {}",
			host,
			port,
			project_path.to_str().unwrap()
		);

		server.start()?;

		Ok(())
	}

	fn spawn(self, log_level: LevelFilter) -> Result<()> {
		let program = env::current_exe().unwrap_or(PathBuf::from("argon"));

		let log_style = env::var("RUST_LOG_STYLE").unwrap_or("auto".to_string());
		let backtrace = env::var("RUST_BACKTRACE").unwrap_or("0".to_string());

		let verbosity = match log_level {
			LevelFilter::Off => "-q",
			LevelFilter::Error => "",
			LevelFilter::Warn => "-v",
			LevelFilter::Info => "-vv",
			LevelFilter::Debug => "-vvv",
			LevelFilter::Trace => "-vvvv",
		};

		let mut args = vec![String::from("run")];

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

		if let Some(session_id) = self.session_id {
			args.push(session_id);
		}

		if self.ts {
			args.push(String::from("--ts"));
		}

		if !verbosity.is_empty() {
			args.push(verbosity.to_string());
		}

		Command::new(program)
			.args(args)
			.arg("--run")
			.env("RUST_LOG_STYLE", log_style)
			.env("RUST_BACKTRACE", backtrace)
			.spawn()?;

		Ok(())
	}
}
